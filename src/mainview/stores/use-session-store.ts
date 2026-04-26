import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionMeta, ProjectTab, ContentBlock, ContextUsage, SessionStatus } from "../types";
import { apiClient } from "../lib/api-client";
import { messageToChatMessage } from "../lib/message-mapper";
import type { AgentEvent } from "../../shared/modules/agent";
import type { AssistantMessage } from "@dyyz1993/pi-ai";
import { extractTokenUsage } from "../lib/message-mapper";
import { useChatStore } from "./use-chat-store";
import { useAppStore } from "./use-app-store";
import { useSubagentStore, handleSubagentEvent } from "./use-subagent-store";
import { useBashStore, handleBashEvent, handleBackgroundExit } from "./use-bash-store";
import { useLspStore } from "./use-lsp-store";
import { useExplorerStore } from "./use-explorer-store";
import { useMemoryStore } from "./use-memory-store";
import { useStatusStore } from "./use-status-store";
import { batchMessageUpdate, flushNow } from "./message-batcher";

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
  bashSubscriptions: Record<string, string>;
  lspSubscriptions: Record<string, string>;
  notifySubscriptions: Record<string, string>;
  todosBySession: Record<string, TodoItem[]>;
  sessionContextMap: Record<string, ContextUsage>;
  sessionStatusMap: Record<string, SessionStatus>;

  addProjectTab: (tab: ProjectTab) => void;
  removeProjectTab: (id: string) => void;
  setActiveProject: (id: string) => void;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  setActiveSession: (id: string | null) => void;
  createNewSession: () => Promise<void>;
  renameSession: (sessionId: string, newName: string) => void;
  deleteSession: (sessionId: string) => void;
  togglePinSession: (sessionId: string) => void;
  setSessionTodos: (sessionId: string, todos: TodoItem[]) => void;
  restoreFromPersisted: () => Promise<boolean>;
  updateSessionContext: (sessionId: string, usage: Partial<ContextUsage>) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  restoreContextFromHistory: (sessionId: string) => void;
  fetchInitialState: (sessionId: string) => void;
}

function setupSubscriptions(
  state: SessionState,
  set: (fn: (s: SessionState) => Partial<SessionState>) => void,
  id: string,
  session: SessionMeta,
): void {
  const { agentSubscriptions, subagentSubscriptions, todoSubscriptions, bashSubscriptions, lspSubscriptions, notifySubscriptions } = state;
  const storeGet = () => useSessionStore.getState() as SessionState;

  if (!agentSubscriptions[id]) {
    apiClient.subscribe("agent.event", (payload: { sessionId: string; event: AgentEvent }) => {
      if (payload.sessionId !== id) return;
      handleAgentEvent(id, payload.event);
    }).then((subId) => {
      set((s) => ({
        agentSubscriptions: { ...s.agentSubscriptions, [id]: subId },
      }));

      apiClient.call("agent.start", {
        sessionId: id,
        projectPath: session.projectPath,
        sessionPath: session.sessionPath,
      }).then((result) => {
        if (result.status === "already_running" || result.status === "started") {
          const chatState = useChatStore.getState();
          const cached = chatState.messagesBySession[id];
          if (!cached || cached.length === 0) {
            chatState.loadSessionMessages(id);
          }
          storeGet().fetchInitialState(id);
        }
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

        handleSubagentEvent(sid, payload.event, id);

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

  if (!bashSubscriptions[id]) {
    apiClient.subscribe(
      "bash.event",
      (payload: { sessionId: string; event: import("../../shared/modules/bash").BashChannelEvent }) => {
        if (payload.sessionId !== id) return;
        handleBashEvent(id, payload.event);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        bashSubscriptions: { ...s.bashSubscriptions, [id]: subId },
      }));
      useBashStore.getState().loadHistory(session.sessionPath, id).catch(() => {});
    }).catch(() => {});
  }

  if (!lspSubscriptions[id]) {
    apiClient.subscribe(
      "lsp.event",
      (payload: { sessionId: string; event: import("../../shared/modules/lsp").LspChannelEvent }) => {
        if (payload.sessionId !== id) return;
        useLspStore.getState().handleLspEvent(id, payload.event);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        lspSubscriptions: { ...s.lspSubscriptions, [id]: subId },
      }));
      useLspStore.getState().loadHistory(session.sessionPath, id).catch(() => {});
    }).catch(() => {});
  }

  if (!notifySubscriptions[id]) {
    apiClient.subscribe(
      "agent.notify",
      (payload: { sessionId: string; message: string; notifyType: "info" | "warning" | "error" }) => {
        if (payload.sessionId !== id) return;
        const chat = useChatStore.getState();
        const existing = chat.messagesBySession[id] || [];
        const notifyMsg: import("../types").ChatMessage = {
          id: `notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          content: [{
            type: "text",
            text: payload.notifyType === "warning"
              ? `⚠️ ${payload.message}`
              : payload.notifyType === "error"
                ? `❌ ${payload.message}`
                : `ℹ️ ${payload.message}`,
          }],
          timestamp: Date.now(),
        };
        chat.setMessagesForSession(id, [...existing, notifyMsg]);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        notifySubscriptions: { ...s.notifySubscriptions, [id]: subId },
      }));
    }).catch(() => {});
  }
}

function syncTabsToBackend(tabs: ProjectTab[], activeTabId: string | null) {
  const persistTabs = tabs.map((t) => ({ id: t.id, name: t.name, path: t.path }));
  apiClient.call("project.syncTabs", { tabs: persistTabs, activeTabId }).catch(() => {});
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
      bashSubscriptions: {},
      lspSubscriptions: {},
      notifySubscriptions: {},
      todosBySession: {},
      sessionContextMap: {},
      sessionStatusMap: {},

      addProjectTab: (tab) =>
        set((s) => {
          const exists = s.projectTabs.find((t) => t.path === tab.path);
          if (exists) {
            syncTabsToBackend(s.projectTabs, exists.id);
            return { activeProjectId: exists.id };
          }
          const next = [...s.projectTabs, tab];
          syncTabsToBackend(next, tab.id);
          return {
            projectTabs: next,
            activeProjectId: tab.id,
          };
        }),

      removeProjectTab: (id) =>
        set((s) => {
          const filtered = s.projectTabs.filter((t) => t.id !== id);
          const newActiveId =
            s.activeProjectId === id
              ? filtered[filtered.length - 1]?.id ?? null
              : s.activeProjectId;
          syncTabsToBackend(filtered, newActiveId);
          return {
            projectTabs: filtered,
            activeProjectId: newActiveId,
          };
        }),

      setActiveProject: (id) => {
        set({ activeProjectId: id });
        const tabs = get().projectTabs;
        syncTabsToBackend(tabs, id);
        const tab = tabs.find((t) => t.id === id);
        if (!tab) return;

        const explorer = useExplorerStore.getState();
        explorer.setCurrentPath(tab.path);
        explorer.listRootDir();

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

      togglePinSession: (sessionId) => {
        let isCurrentlyPinned = false;
        set((s) => {
          const updated: Record<string, SessionMeta[]> = {};
          for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
            updated[path] = sessions.map((sess) => {
              if (sess.sessionId === sessionId) {
                isCurrentlyPinned = sess.pinned ?? false;
                return { ...sess, pinned: !isCurrentlyPinned };
              }
              return sess;
            });
          }
          return { sessionsByProject: updated };
        });

        if (isCurrentlyPinned) {
          apiClient.call("session.unpin", { sessionId }).catch(() => {});
        } else {
          apiClient.call("session.pin", { sessionId }).catch(() => {});
        }
      },

      setSessionTodos: (sessionId, todos) => {
        set((s) => ({
          todosBySession: { ...s.todosBySession, [sessionId]: todos },
        }));
      },

      updateSessionContext: (sessionId, usage) => {
        set((s) => {
          const prev = s.sessionContextMap[sessionId] || { tokens: null, contextWindow: 0 };
          return {
            sessionContextMap: { ...s.sessionContextMap, [sessionId]: { ...prev, ...usage } },
          };
        });
      },

      updateSessionStatus: (sessionId, status) => {
        set((s) => ({
          sessionStatusMap: { ...s.sessionStatusMap, [sessionId]: status },
        }));
      },

      restoreContextFromHistory: (sessionId) => {
        const existing = get().sessionContextMap[sessionId];
        if (existing?.tokens != null && existing.tokens > 0) return;
        const msgs = useChatStore.getState().messagesBySession[sessionId];
        if (!msgs || msgs.length === 0) return;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (m.role === "assistant" && m.tokenUsage) {
            const total = m.tokenUsage.input + m.tokenUsage.output
              + (m.tokenUsage.reasoning ?? 0)
              + (m.tokenUsage.cacheRead ?? 0)
              + (m.tokenUsage.cacheWrite ?? 0);
            if (total > 0) {
              get().updateSessionContext(sessionId, { tokens: total });
            }
            return;
          }
        }
      },

      fetchInitialState: (sessionId) => {
        apiClient.call("agent.getState", { sessionId }).then((result) => {
          if (!result) return;
          const cw = result.model?.contextWindow || 0;
          if (cw > 0) {
            get().updateSessionContext(sessionId, { contextWindow: cw });
          }
          if (result.isStreaming) {
            get().updateSessionStatus(sessionId, "streaming");
          } else if (result.isCompacting) {
            get().updateSessionStatus(sessionId, "compacting");
          } else {
            get().updateSessionStatus(sessionId, "idle");
          }

          apiClient.call("agent.getSessionStats", { sessionId }).then((stats) => {
            if (!stats?.contextUsage) return;
            const cu = stats.contextUsage;
            const update: Partial<ContextUsage> = {};
            if (cu.contextWindow > 0) update.contextWindow = cu.contextWindow;
            if (cu.tokens != null) update.tokens = cu.tokens;
            if (update.contextWindow || update.tokens != null) {
              get().updateSessionContext(sessionId, update);
            }
          }).catch(() => {});

          apiClient.call("agent.getCommands", { sessionId }).then((commands) => {
            if (!Array.isArray(commands)) return;
            const plugins = commands
              .filter((c) => c.source === "extension")
              .map((c) => ({ name: c.name, enabled: true }));
            useStatusStore.getState().setPlugins(plugins);
          }).catch(() => {});
        }).catch(() => {});
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

function handleAgentEvent(sessionId: string, event: AgentEvent) {
  const storeGet = () => useSessionStore.getState() as SessionState;

  if (event.type === "agent_start") {
    storeGet().updateSessionStatus(sessionId, "streaming");
    return;
  }

  if (event.type === "agent_end") {
    storeGet().updateSessionStatus(sessionId, "idle");
    const allSessions = storeGet().sessionsByProject;
    for (const sessList of Object.values(allSessions)) {
      const session = sessList.find((s) => s.sessionId === sessionId);
      if (session) {
        useMemoryStore.getState().loadFiles(session.projectPath, sessionId);
        break;
      }
    }
    return;
  }

  if (event.type === "compaction_start") {
    storeGet().updateSessionStatus(sessionId, "compacting");
    return;
  }

  if (event.type === "compaction_end") {
    const result = event.result as { tokensAfter?: number; tokensBefore?: number } | undefined;
    const tokensAfter = result?.tokensAfter;
    storeGet().updateSessionContext(sessionId, { tokens: tokensAfter ?? null });
    storeGet().updateSessionStatus(sessionId, "idle");
    return;
  }

  if (event.type === "extension_ui_request") {
    if (event.method === "confirm" || event.method === "select" || event.method === "input") {
      storeGet().updateSessionStatus(sessionId, "permission");
    }
    return;
  }

  if (event.type === "message_start") {
    const raw = event.message;
    const msgObj = typeof raw === "object" && raw !== null ? raw as unknown as Record<string, unknown> : null;
    const role = msgObj && typeof msgObj.role === "string" ? msgObj.role : "";
    if (role !== "assistant") return;

    const msg = messageToChatMessage(raw, undefined, toolCallNameMap);

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const lastMsg = existing[existing.length - 1];

    if (lastMsg && lastMsg.role === "assistant" && lastMsg.isStreaming === true) {
      const content = msg ? msg.content.filter((b) => b.type !== "toolCall") : lastMsg.content;
      chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), { ...lastMsg, content, isStreaming: true }]);
    } else if (msg) {
      msg.content = msg.content.filter((b) => b.type !== "toolCall");
      chat.setMessagesForSession(sessionId, [...existing, { ...msg, isStreaming: true }]);
    } else {
      chat.setMessagesForSession(sessionId, [...existing, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      }]);
    }
    return;
  }

  if (event.type === "message_update") {
    batchMessageUpdate(sessionId, () => {
      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const lastMsg = existing[existing.length - 1];
      if (!lastMsg || lastMsg.role !== "assistant") return;

      const message = event.message as AssistantMessage;
      const incoming = message.content;
      if (!incoming || !Array.isArray(incoming)) return;

      const preservedToolExecs = lastMsg.content.filter((b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution");
      const execByCallId = new Map<string, Extract<ContentBlock, { type: "toolExecution" }>>();
      for (const exec of preservedToolExecs) {
        execByCallId.set(exec.toolCallId, exec);
      }
      const usedExecs = new Set<string>();

      const textBlocks: ContentBlock[] = [];
      const otherBlocks: ContentBlock[] = [];

      for (const block of incoming) {
        if (block.type === "toolCall" && block.id) {
          const exec = execByCallId.get(block.id);
          if (exec) {
            otherBlocks.push(exec);
            usedExecs.add(block.id);
          }
        } else if (block.type === "text") {
          textBlocks.push(block);
        } else if (block.type === "thinking") {
          otherBlocks.push(block);
        }
      }

      for (const exec of preservedToolExecs) {
        if (!usedExecs.has(exec.toolCallId)) {
          otherBlocks.push(exec);
        }
      }

      chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {
        ...lastMsg,
        content: [...otherBlocks, ...textBlocks],
        ...buildTokenUsage(message.usage),
        ...(message.stopReason ? { stopReason: message.stopReason } : {}),
      }]);
      chat.incrementStreamVersion();
    });
    return;
  }

  if (event.type === "message_end") {
    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const message = event.message as AssistantMessage;

    if (message.usage) {
      const raw = message.usage as unknown as Record<string, unknown>;
      const totalTokens = Number(raw.totalTokens ?? 0);
      if (totalTokens > 0) {
        storeGet().updateSessionContext(sessionId, { tokens: totalTokens });
      }
    }

    chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {
      ...lastMsg,
      content: lastMsg.content,
      isStreaming: false,
      stopReason: message.stopReason ?? lastMsg.stopReason ?? null,
      provider: message.provider || lastMsg.provider,
      model: message.model || lastMsg.model,
      ...buildTokenUsage(message.usage),
    }]);
    flushNow();
    return;
  }

  if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
    const toolCallId = event.toolCallId;
    const toolName = event.toolName || "unknown";

    if (event.type === "tool_execution_start") {
      toolCallNameMap[toolCallId] = toolName;
    }

    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

    batchMessageUpdate(sessionId, () => {
      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const lastMsg = existing[existing.length - 1];
      if (!lastMsg || lastMsg.role !== "assistant") return;

      const blocks = [...lastMsg.content];
      const targetIdx = blocks.findIndex((b): b is ToolExecBlock =>
        b.type === "toolExecution" && b.toolCallId === toolCallId
      );

      if (event.type === "tool_execution_start") {
        const args = event.args;
        const argsStr = args && typeof args === "object" && "command" in args && typeof args.command === "string"
          ? args.command
          : args ? JSON.stringify(args, null, 2) : "";
        blocks.push({ type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" });
      } else if (event.type === "tool_execution_update") {
        const partial = event.partialResult as { content?: Array<{ type: string; text?: string }> } | undefined;
        let output = "";
        if (partial) {
          if (Array.isArray(partial.content)) {
            output = partial.content.map((c) => c.text ?? "").join("");
          }
        }
        if (targetIdx >= 0) {
          const prev = blocks[targetIdx] as ToolExecBlock;
          blocks[targetIdx] = { ...prev, output };
        }
      } else if (event.type === "tool_execution_end") {
        const isError = event.isError;
        let output = "";
        const result = event.result as { content?: Array<{ type: string; text?: string }>; details?: unknown } | undefined;
        if (result) {
          if (Array.isArray(result.content)) {
            output = result.content.map((c) => c.text ?? "").join("");
          } else {
            output = JSON.stringify(result, null, 2);
          }
        }
        if (targetIdx >= 0) {
          const prev = blocks[targetIdx] as ToolExecBlock;
          blocks[targetIdx] = { ...prev, status: isError ? "error" : "done", output, details: result?.details };
        }
      }

      const updated = [...existing];
      updated[existing.length - 1] = { ...lastMsg, content: blocks };
      chat.setMessagesForSession(sessionId, updated);
      chat.incrementStreamVersion();
    });
    return;
  }

  if (event.type === "custom_entry") {
    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const customMsg: import("../types").ChatMessage = {
      id: event.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "custom",
      content: [{ type: "custom", customType: event.customType, data: event.data }],
      timestamp: Date.now(),
    };
    chat.setMessagesForSession(sessionId, [...existing, customMsg]);

    const memoryStore = useMemoryStore.getState();
    memoryStore.addEvent(sessionId, {
      id: event.id || `custom-${Date.now()}`,
      customType: event.customType as string,
      data: event.data,
      timestamp: Date.now(),
    });

    if (event.customType === "memory_prefetch_result") {
      const data = event.data as { summary?: string; snippet?: string } | undefined;
      if (data) {
        memoryStore.addInjected(sessionId, {
          summary: data.summary || "",
          snippet: data.snippet || "",
        });
      }
    }

    if (event.customType === "bash_background_exit") {
      handleBackgroundExit(sessionId, event.data as import("../../shared/modules/bash").BashBackgroundExitEvent);
    }

    return;
  }
}

function buildTokenUsage(usage: unknown): { tokenUsage?: import("../types").TokenUsage } {
  const result = extractTokenUsage(usage);
  return result ? { tokenUsage: result } : {};
}
