import { create } from "zustand";
import type { SessionMeta, ProjectTab } from "../types";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage, parseContentBlocks } from "../lib/message-mapper";

interface SessionState {
  sessionsByProject: Record<string, SessionMeta[]>;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  activeProjectId: string | null;
  loading: boolean;
  agentSubscriptions: Record<string, string>;

  addProjectTab: (tab: ProjectTab) => void;
  removeProjectTab: (id: string) => void;
  setActiveProject: (id: string) => void;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  setActiveSession: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionsByProject: {},
  activeSessionId: null,
  projectTabs: [],
  activeProjectId: null,
  loading: false,
  agentSubscriptions: {},

  addProjectTab: (tab) =>
    set((s) => {
      const exists = s.projectTabs.find((t) => t.path === tab.path);
      if (exists) {
        return { activeProjectId: exists.id };
      }
      return {
        projectTabs: [...s.projectTabs, tab],
        activeProjectId: tab.id,
      };
    }),

  removeProjectTab: (id) =>
    set((s) => {
      const filtered = s.projectTabs.filter((t) => t.id !== id);
      return {
        projectTabs: filtered,
        activeProjectId:
          s.activeProjectId === id
            ? filtered[filtered.length - 1]?.id ?? null
            : s.activeProjectId,
      };
    }),

  setActiveProject: (id) => set({ activeProjectId: id }),

  loadSessionsForProject: async (projectPath) => {
    set({ loading: true });
    try {
      const result = await apiClient.call("project.scanSessions", { projectPath });
      const sessions = result.sessions as SessionMeta[];
      set((s) => ({
        sessionsByProject: { ...s.sessionsByProject, [projectPath]: sessions },
        loading: false,
      }));
      return sessions;
    } catch {
      set({ loading: false });
      return [];
    }
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id });
    if (!id) return;

    const { sessionsByProject, projectTabs, activeProjectId, agentSubscriptions } = get();
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return;
    const sessions = sessionsByProject[tab.path];
    const session = sessions?.find((s) => s.sessionId === id);
    if (!session) return;

    // 1. 先订阅事件（确保不丢事件）
    if (!agentSubscriptions[id]) {

    apiClient.subscribe("agent.event", (payload: { sessionId: string; event: Record<string, unknown> }) => {
      if (payload.sessionId !== id) return;

      const event = payload.event;
      const eventType = event.type as string;

      if (eventType === "extension_ui_request") {
        const INTERACTIVE = new Set(["confirm", "input", "select", "editor"]);
        const method = event.method as string;
        if (!INTERACTIVE.has(method)) return;
        const requestId = event.id as string;
        const options = event.options as string[] | undefined;
        let response: Record<string, unknown>;
        switch (method) {
          case "select": response = { value: options?.[0] ?? "" }; break;
          case "confirm": response = { confirmed: true }; break;
          default: response = { value: "" }; break;
        }
        apiClient.call("agent.respondUI", { sessionId: id, requestId, response }).catch(() => {});
        return;
      }

      import("../stores/use-chat-store").then(({ useChatStore }) => {
        const chat = useChatStore.getState();
        const existing = chat.messagesBySession[id] || [];

        if (eventType === "message_start") {
          const raw = event.message as Record<string, unknown>;
          if (!raw) return;
          // assistant 的 message_start 内容为空数组，仍需创建占位消息以启用流式
          const content = parseContentBlocks(raw.content);
          const role = raw.role as string;
          const msg: import("../types").ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: role as "user" | "assistant" | "toolResult",
            content,
            timestamp: (raw.timestamp as number) || Date.now(),
            isStreaming: true,
          };
          if (raw.provider) msg.provider = raw.provider as string;
          if (raw.model) msg.model = raw.model as string;
          chat.setMessagesForSession(id, [...existing, msg]);
        }

        if (eventType === "message_update") {
          // agent 通过 assistantMessageEvent.partial 传递累积内容
          const assistantEvt = event.assistantMessageEvent as Record<string, unknown> | undefined;
          const raw = (event.message as Record<string, unknown>) || (assistantEvt?.partial as Record<string, unknown>);
          if (!raw) return;
          const lastMsg = existing[existing.length - 1];
          if (lastMsg?.role === "assistant" && lastMsg.isStreaming) {
            const content = parseContentBlocks(raw.content);
            // 内容为空时也保留（thinking_start 阶段 partial 可能无 text）
            if (content.length === 0 && !raw.content) return;
            const updated = [...existing];
            updated[updated.length - 1] = {
              ...lastMsg,
              content: content.length > 0 ? content : lastMsg.content,
              provider: (raw.provider as string) || lastMsg.provider,
              model: (raw.model as string) || lastMsg.model,
            };
            chat.setMessagesForSession(id, updated);
          }
        }

        if (eventType === "message_end") {
          const raw = event.message as Record<string, unknown>;
          if (!raw) return;
          const lastMsg = existing[existing.length - 1];

          if (lastMsg?.isStreaming) {
            const content = parseContentBlocks(raw.content);
            const updated = [...existing];
            updated[updated.length - 1] = {
              ...lastMsg,
              content,
              isStreaming: false,
              stopReason: (raw.stopReason as string) ?? null,
              provider: (raw.provider as string) || lastMsg.provider,
              model: (raw.model as string) || lastMsg.model,
            };
            chat.setMessagesForSession(id, updated);
          } else {
            const msg = messageToChatMessage(raw);
            if (msg) {
              chat.setMessagesForSession(id, [...existing, msg]);
            }
          }
        }
      });
    }).then((subId) => {
      set((s) => ({
        agentSubscriptions: { ...s.agentSubscriptions, [id]: subId },
      }));

      // 2. 订阅成功后加载历史消息
      import("../stores/use-chat-store").then(({ useChatStore }) => {
        const chatState = useChatStore.getState();
        const cached = chatState.messagesBySession[id];
        if (!cached || cached.length === 0) {
          chatState.loadSessionMessages(session.sessionPath);
        }
      });

      // 3. 最后启动 agent 进程
      apiClient.call("agent.start", {
        sessionId: id,
        projectPath: session.projectPath,
        sessionPath: session.sessionPath,
      }).catch(() => {});
      }).catch(() => {});
    }
  },
}));
