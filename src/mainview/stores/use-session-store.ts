import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionMeta, ProjectTab } from "../types";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage } from "../lib/message-mapper";
import type { ContentBlock } from "../types";
import { useChatStore } from "./use-chat-store";
import { useAppStore } from "./use-app-store";
import { useSubagentStore, handleSubagentEvent } from "./use-subagent-store";
import { useExplorerStore } from "./use-explorer-store";
import { useGitStore } from "./use-git-store";

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

/** toolCallId → toolName 映射，供 toolResult 查找工具名 */
const toolCallNameMap: Record<string, string> = {};

interface SessionState {
  sessionsByProject: Record<string, SessionMeta[]>;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  activeProjectId: string | null;
  loading: boolean;
  agentSubscriptions: Record<string, string>;
  subagentSubscriptions: Record<string, string>;
  todoSubscriptions: Record<string, string>;
  todosBySession: Record<string, TodoItem[]>;

  addProjectTab: (tab: ProjectTab) => void;
  removeProjectTab: (id: string) => void;
  setActiveProject: (id: string) => void;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  setActiveSession: (id: string | null) => void;
  createNewSession: () => Promise<void>;
  renameSession: (sessionId: string, newName: string) => void;
  deleteSession: (sessionId: string) => void;
  setSessionTodos: (sessionId: string, todos: TodoItem[]) => void;
  restoreFromPersisted: () => Promise<boolean>;
}

function setupSubscriptions(
  state: SessionState,
  set: (fn: (s: SessionState) => Partial<SessionState>) => void,
  id: string,
  session: SessionMeta,
): void {
  const { agentSubscriptions, subagentSubscriptions, todoSubscriptions } = state;
  const storeGet = () => useSessionStore.getState() as SessionState;

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

  if (!subagentSubscriptions[id]) {
    apiClient.subscribe(
      "subagent.event",
      (payload: { parentSessionId: string; parentSessionPath?: string; subSessionId: string; event: Record<string, unknown> }) => {
        if (payload.parentSessionId !== id) return;

        const subStore = useSubagentStore.getState();
        const sid = payload.subSessionId;
        const path = payload.parentSessionPath || session.sessionPath;
        const eventType = payload.event.type as string;

        if (eventType === "subagent_start") {
          subStore.upsertLiveSubagent(path, sid, {
            sessionId: sid,
            toolCallId: (payload.event.toolCallId as string) || undefined,
            description: (payload.event.description as string) || "",
            instruction: (payload.event.instruction as string) || "",
            startedAt: Date.now(),
          });
          return;
        }

        const existing = subStore.subsessionsByParent[path] || [];
        if (!existing.find((s) => s.sessionId === sid)) {
          subStore.upsertLiveSubagent(path, sid, {
            sessionId: sid,
            startedAt: Date.now(),
          });
        }

        handleSubagentEvent(sid, payload.event);

        if (eventType === "agent_end") {
          subStore.upsertLiveSubagent(path, sid, {
            completedAt: Date.now(),
            exitCode: 0,
          });
        }
      },
      { parentSessionId: id },
    ).then((subId) => {
      set((s) => ({
        subagentSubscriptions: { ...s.subagentSubscriptions, [id]: subId },
      }));
    }).catch(() => {});
  }

  if (!todoSubscriptions[id]) {
    apiClient.subscribe(
      "todo.event",
      (payload: { sessionId: string; action: string; todos: Array<{ id: number; text: string; done: boolean }>; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        storeGet().setSessionTodos(id, payload.todos as TodoItem[]);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        todoSubscriptions: { ...s.todoSubscriptions, [id]: subId },
      }));
      apiClient.call("todo.list", { sessionPath: session.sessionPath }).then((result) => {
        const todos = (result as { todos: TodoItem[] }).todos || [];
        if (todos.length > 0) {
          storeGet().setSessionTodos(id, todos);
        }
      }).catch(() => {});
    }).catch(() => {});
  }
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
      subagentSubscriptions: {},
      todoSubscriptions: {},
      todosBySession: {},

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

      setActiveProject: (id) => {
        set({ activeProjectId: id });
        const tab = get().projectTabs.find((t) => t.id === id);
        if (!tab) return;

        const explorer = useExplorerStore.getState();
        if (explorer.currentPath !== tab.path) {
          explorer.setCurrentPath(tab.path);
          explorer.listRootDir();
        }

        const git = useGitStore.getState();
        git.refresh(tab.path);
        git.fetchBranches(tab.path);
        git.fetchLog(tab.path);

        get().loadSessionsForProject(tab.path).then((sessions) => {
          if (sessions.length > 0) {
            const current = get().activeSessionId;
            const belongs = sessions.some((s) => s.sessionId === current);
            if (!belongs) {
              get().setActiveSession(sessions[0].sessionId);
            }
          }
        });
      },

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

        const { projectTabs, activeProjectId } = get();
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;

        const ensureSession = async (): Promise<SessionMeta | null> => {
          let sessions = get().sessionsByProject[tab.path];
          if (!sessions) {
            sessions = await get().loadSessionsForProject(tab.path);
          }
          return sessions?.find((s) => s.sessionId === id) ?? null;
        };

        ensureSession().then((session) => {
          if (!session) return;
          setupSubscriptions(get(), set, id, session);
        });
      },

      createNewSession: async () => {
        const { projectTabs, activeProjectId } = get();
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;

        try {
          const result = await apiClient.call("session.create", { projectPath: tab.path });

          const now = Date.now();
          const newSession: SessionMeta = {
            sessionId: result.sessionId,
            name: "",
            sessionPath: result.sessionPath,
            projectPath: tab.path,
            parentSessionPath: null,
            messageCount: 0,
            firstMessage: "",
            createdAt: now,
            updatedAt: now,
            status: "idle",
          };

          set((s) => ({
            sessionsByProject: {
              ...s.sessionsByProject,
              [tab.path]: [newSession, ...(s.sessionsByProject[tab.path] || [])],
            },
          }));

          get().setActiveSession(result.sessionId);
        } catch {
          useAppStore.getState().addLog("Failed to create session");
        }
      },

      renameSession: (sessionId, newName) => {
        let sessionPath = "";
        set((s) => {
          const updated: Record<string, SessionMeta[]> = {};
          for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
            updated[path] = sessions.map((sess) => {
              if (sess.sessionId === sessionId) {
                sessionPath = sess.sessionPath;
                return { ...sess, name: newName };
              }
              return sess;
            });
          }
          return { sessionsByProject: updated };
        });
        if (sessionPath) {
          apiClient.call("session.rename", { sessionId, sessionPath, newName }).catch(() => {});
        }
      },

      deleteSession: (sessionId) => {
        const { sessionsByProject, activeSessionId } = get();
        let deletedPath = "";
        let deletedSessionPath = "";
        const updated: Record<string, SessionMeta[]> = {};
        for (const [path, sessions] of Object.entries(sessionsByProject)) {
          const filtered = sessions.filter((s) => {
            if (s.sessionId === sessionId) {
              deletedSessionPath = s.sessionPath;
              return false;
            }
            return true;
          });
          if (filtered.length !== sessions.length) deletedPath = path;
          updated[path] = filtered;
        }
        set({
          sessionsByProject: updated,
          activeSessionId: activeSessionId === sessionId ? null : activeSessionId,
        });
        if (deletedPath) {
          useChatStore.getState().clearSessionMessages(sessionId);
        }
        if (deletedSessionPath) {
          apiClient.call("session.delete", { sessionId, sessionPath: deletedSessionPath }).catch(() => {});
        }
      },

      setSessionTodos: (sessionId, todos) => {
        set((s) => ({
          todosBySession: { ...s.todosBySession, [sessionId]: todos },
        }));
      },

      restoreFromPersisted: async () => {
        const { activeProjectId, activeSessionId, projectTabs } = get();
        if (!activeProjectId || !activeSessionId || projectTabs.length === 0) {
          return false;
        }

        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) {
          set({ activeProjectId: null, activeSessionId: null });
          return false;
        }

        try {
          const sessions = await get().loadSessionsForProject(tab.path);
          const found = sessions?.find((s) => s.sessionId === activeSessionId);
          if (found) {
            get().setActiveSession(activeSessionId);
            return true;
          }

          if (sessions.length > 0) {
            get().setActiveSession(sessions[0].sessionId);
            return true;
          }

          return false;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "pi-agent-session",
      partialize: (state) => ({
        projectTabs: state.projectTabs,
        activeProjectId: state.activeProjectId,
        activeSessionId: state.activeSessionId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state?.activeProjectId || !state?.activeSessionId || !state?.projectTabs?.length) return;
        const { activeProjectId, activeSessionId, projectTabs } = state;
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;

        setTimeout(() => {
          state.setActiveProject(activeProjectId);
          state.loadSessionsForProject(tab.path).then((sessions) => {
            const found = sessions?.find((s) => s.sessionId === activeSessionId);
            if (found) {
              state.setActiveSession(activeSessionId);
            }
          });
        }, 200);
      },
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
      msg.content = msg.content.filter((b) => b.type !== "toolCall");
      const lastMsg = existing[existing.length - 1];
      if (lastMsg && lastMsg.role === "assistant" && lastMsg.isStreaming !== false) {
        chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), { ...lastMsg, content: msg.content, isStreaming: true }]);
      } else {
        chat.setMessagesForSession(sessionId, [...existing, { ...msg, isStreaming: true }]);
      }
    }
  } else if (eventType === "message_update") {
    const raw = event.message as Record<string, unknown>;
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const incoming = raw.content as ContentBlock[] | undefined;
    if (!incoming || !Array.isArray(incoming)) return;

    const preservedToolExecs = (lastMsg.content as ContentBlock[]).filter((b) => b.type === "toolExecution");
    const updatedContent: ContentBlock[] = [];

    for (const block of incoming) {
      if (block.type === "toolCall") continue;
      updatedContent.push(block);
    }

    chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), { ...lastMsg, content: [...updatedContent, ...preservedToolExecs] }]);
  } else if (eventType === "message_end") {
    const raw = event.message as Record<string, unknown>;
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const rawUsage = raw.usage as Record<string, unknown> | undefined;
    let tokenUsage: import("../types").TokenUsage | undefined;
    if (rawUsage) {
      const input = Number(rawUsage.inputTokens ?? rawUsage.promptTokens ?? rawUsage.input ?? 0);
      const output = Number(rawUsage.outputTokens ?? rawUsage.completionTokens ?? rawUsage.output ?? 0);
      const reasoning = Number(rawUsage.reasoningTokens ?? rawUsage.reasoning ?? 0);
      const cacheRead = Number(rawUsage.cacheReadInputTokens ?? rawUsage.cacheRead ?? 0);
      const cacheWrite = Number(rawUsage.cacheCreationInputTokens ?? rawUsage.cacheWrite ?? 0);
      const cost = Number(rawUsage.cost ?? rawUsage.totalCost ?? 0);
      if (input || output || reasoning || cacheRead || cacheWrite) {
        tokenUsage = { input, output, reasoning: reasoning || undefined, cacheRead: cacheRead || undefined, cacheWrite: cacheWrite || undefined, cost: cost || undefined };
      }
    }

    chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {
      ...lastMsg,
      content: lastMsg.content,
      isStreaming: false,
      stopReason: (raw.stopReason as string) ?? null,
      provider: (raw.provider as string) || lastMsg.provider,
      model: (raw.model as string) || lastMsg.model,
      tokenUsage: tokenUsage || lastMsg.tokenUsage,
    }]);
  } else if (eventType === "custom_message") {
    return;
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
        } else if (partial.text) {
          output = String(partial.text);
        }
      }
      if (!output && event.output) output = String(event.output);
      if (!output && event.result) {
        const r = event.result as Record<string, unknown>;
        if (typeof r === "string") output = r;
        else if (r?.content) {
          const rc = r.content as Array<{ type: string; text?: string }> | string | undefined;
          if (Array.isArray(rc)) output = rc.map((c: { text?: string }) => c.text ?? "").join("");
          else if (typeof rc === "string") output = rc;
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
