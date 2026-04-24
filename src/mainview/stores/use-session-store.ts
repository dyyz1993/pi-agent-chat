import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionMeta, ProjectTab } from "../types";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage } from "../lib/message-mapper";
import type { ContentBlock } from "../types";
import { useChatStore } from "./use-chat-store";

/** toolCallId → toolName 映射，供 toolResult 查找工具名 */
const toolCallNameMap: Record<string, string> = {};

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

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
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

        if (!agentSubscriptions[id]) {
          apiClient.subscribe("agent.event", (payload: { sessionId: string; event: Record<string, unknown> }) => {
            if (payload.sessionId !== id) return;
            handleAgentEvent(id, payload.event);
          }).then((subId) => {
            set((s) => ({
              agentSubscriptions: { ...s.agentSubscriptions, [id]: subId },
            }));

            const chatState = useChatStore.getState();
            const cached = chatState.messagesBySession[id];
            if (!cached || cached.length === 0) {
              chatState.loadSessionMessages(session.sessionPath);
            }

            apiClient.call("agent.start", {
              sessionId: id,
              projectPath: session.projectPath,
              sessionPath: session.sessionPath,
            }).catch(() => {});
          }).catch(() => {});
        }
      },
    }),
    {
      name: "pi-agent-session",
      partialize: (state) => ({
        projectTabs: state.projectTabs,
        activeProjectId: state.activeProjectId,
      }),
    }
  )
);

function handleAgentEvent(sessionId: string, event: Record<string, unknown>) {
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
    apiClient.call("agent.respondUI", { sessionId, requestId, response }).catch(() => {});
    return;
  }

  const chat = useChatStore.getState();
  const existing = chat.messagesBySession[sessionId] || [];

  if (eventType === "message_start") {
    const raw = event.message as Record<string, unknown>;
    const msg = messageToChatMessage(raw, undefined, toolCallNameMap);
    if (msg) {
      chat.setMessagesForSession(sessionId, [...existing, msg]);
    }
  } else if (eventType === "message_update") {
    const raw = event.message as Record<string, unknown>;
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = (lastMsg.content as ContentBlock[]) || [];
    const content = raw.content as ContentBlock[];
    if (!content || !Array.isArray(content)) return;

    const updated: ContentBlock[] = [...blocks];
    for (const block of content) {
      if (block.type === "text") {
        const lastBlock = updated[updated.length - 1];
        if (lastBlock?.type === "text") {
          (lastBlock as { text: string }).text += block.text;
        } else {
          updated.push(block);
        }
      } else {
        updated.push(block);
      }
    }

    chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), { ...lastMsg, content: updated }]);
  } else if (eventType === "message_end") {
    const raw = event.message as Record<string, unknown>;
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {
      ...lastMsg,
      content: lastMsg.content,
      isStreaming: false,
      stopReason: (raw.stopReason as string) ?? null,
      provider: (raw.provider as string) || lastMsg.provider,
      model: (raw.model as string) || lastMsg.model,
    }]);
  } else if (event.message) {
    const raw = event.message as Record<string, unknown>;
    const msg = messageToChatMessage(raw, undefined, toolCallNameMap);
    if (msg) {
      chat.setMessagesForSession(sessionId, [...existing, msg]);
    }
  }

  if (eventType === "tool_execution_start" || eventType === "tool_execution_update" || eventType === "tool_execution_end") {
    // 记录 toolCallId → toolName 映射
    if (eventType === "tool_execution_start") {
      const toolCallId = event.toolCallId as string;
      const toolName = (event.toolName as string) || "unknown";
      toolCallNameMap[toolCallId] = toolName;
    }
    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const toolCallId = event.toolCallId as string;
    const toolName = (event.toolName as string) || "unknown";
    const args = event.args as Record<string, unknown> | undefined;
    const argsStr = args ? (typeof args.command === "string" ? args.command : JSON.stringify(args, null, 2)) : "";

    const freshMessages = chat.messagesBySession[sessionId] || [];
    const lastMsg = freshMessages[freshMessages.length - 1];
    if (!lastMsg) return;

    const blocks = (lastMsg.content as ContentBlock[]) || [];
    const targetIdx = blocks.findIndex((b): b is ToolExecBlock =>
      b.type === "toolExecution" && b.toolCallId === toolCallId
    );

    if (eventType === "tool_execution_start") {
      blocks.push({ type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" });
    } else if (eventType === "tool_execution_update") {
      const partial = event.partialResult as Record<string, unknown> | undefined;
      let output = "";
      if (partial) {
        const partialContent = partial.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(partialContent)) {
          output = partialContent.map((c) => c.text ?? "").join("");
        } else if (typeof partial === "string") {
          output = partial;
        } else {
          output = JSON.stringify(partial, null, 2);
        }
      }
      if (targetIdx >= 0) {
        const prev = blocks[targetIdx] as ToolExecBlock;
        blocks[targetIdx] = { ...prev, output: (prev.output ?? "") + output };
      }
    } else if (eventType === "tool_execution_end") {
      const result = event.result as Record<string, unknown> | undefined;
      const isError = event.isError as boolean;
      let output = "";
      if (result) {
        const resultContent = result.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(resultContent)) {
          output = resultContent.map((c) => c.text ?? "").join("");
        } else {
          output = JSON.stringify(result, null, 2);
        }
      }
      if (targetIdx >= 0) {
        const prev = blocks[targetIdx] as ToolExecBlock;
        blocks[targetIdx] = { ...prev, status: isError ? "error" : "done", output: (prev.output ?? "") + output };
      }
    }

    const updated = [...freshMessages];
    updated[freshMessages.length - 1] = { ...updated[freshMessages.length - 1], content: blocks };
    chat.setMessagesForSession(sessionId, updated);
  }
}
