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
import { useBashStore, handleBashEvent } from "./use-bash-store";
import { useLspStore } from "./use-lsp-store";
import { useRulesStore } from "./use-rules-store";
import { useExplorerStore } from "./use-explorer-store";
import { useMemoryStore } from "./use-memory-store";
import { ALL_MEMORY_TYPE_KEYS } from "../components/chat/memory-config";
import { useStatusStore, deriveSkillScope } from "./use-status-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { useRetryStore } from "./use-retry-store";
import { notificationGateway } from "../lib/notification-gateway";
import { batchMessageUpdate, flushNow } from "./message-batcher";

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  priority?: TodoPriority;
  deleted?: boolean;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
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
  rulesSubscriptions: Record<string, string>;
  notifySubscriptions: Record<string, string>;
  memorySubscriptions: Record<string, string[]>;
  sessionReady: Record<string, boolean>;
  todosBySession: Record<string, TodoItem[]>;
  sessionContextMap: Record<string, ContextUsage>;
  sessionStatusMap: Record<string, SessionStatus>;
  queueBySession: Record<string, { steering: string[]; followUp: string[] }>;
  currentModel: ModelInfo | null;
  currentThinkingLevel: string;
  availableModels: Array<{ provider: string; id: string; name?: string; contextWindow?: number; reasoning?: boolean }>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  _projectVersion: number;

  addProjectTab: (tab: ProjectTab) => void;
  removeProjectTab: (id: string) => void;
  setActiveProject: (id: string) => void;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  setActiveSession: (id: string | null, force?: boolean) => void;
  retryActiveProject: () => void;
  createNewSession: (projectPath?: string) => Promise<void>;
  renameSession: (sessionId: string, newName: string) => void;
  deleteSession: (sessionId: string) => void;
  togglePinSession: (sessionId: string) => void;
  setSessionTodos: (sessionId: string, todos: TodoItem[]) => void;
  restoreFromPersisted: () => Promise<boolean>;
  updateSessionContext: (sessionId: string, usage: Partial<ContextUsage>) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  restoreContextFromHistory: (sessionId: string) => void;
  fetchInitialState: (sessionId: string) => void;
  fetchModelState: (sessionId: string) => void;
  setCurrentModel: (provider: string, modelId: string) => void;
  setThinkingLevel: (level: string) => void;
}

function setupSubscriptions(
  state: SessionState,
  set: (fn: (s: SessionState) => Partial<SessionState>) => void,
  id: string,
  session: SessionMeta,
): void {
  const { agentSubscriptions, subagentSubscriptions, todoSubscriptions, bashSubscriptions, lspSubscriptions, rulesSubscriptions, notifySubscriptions, memorySubscriptions } = state;
  const storeGet = () => useSessionStore.getState() as SessionState;

  if (!agentSubscriptions[id]) {
    apiClient.subscribe("agent.event", (payload: { sessionId: string; event: AgentEvent }) => {
      if (payload.sessionId !== id) return;
      handleAgentEvent(id, payload.event);
    }).then((subId) => {
      set((s) => ({
        agentSubscriptions: { ...s.agentSubscriptions, [id]: subId },
      }));
      apiClient.call("rules.requestSnapshot", { sessionId: id }).then((raw: unknown) => {
        const result = raw && typeof raw === "object" && "result" in raw ? (raw as Record<string, unknown>).result : raw;
        if (result && typeof result === "object" && "type" in result && (result as Record<string, unknown>).type === "snapshot") {
          const snap = result as { totalRules?: number };
          const current = useRulesStore.getState().bySession[id];
          if (snap.totalRules === 0 && current && current.totalRules > 0) return;
          useRulesStore.getState().handleRulesEvent(id, result as import("../../shared/modules/rules").RulesChannelEvent);
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
      (payload: { sessionId: string; action: string; todos: TodoItem[]; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        storeGet().setSessionTodos(id, payload.todos);
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
      useBashStore.getState().loadHistory(id).catch(() => {});
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

  if (!rulesSubscriptions[id]) {
    apiClient.subscribe(
      "rules.event",
      (payload: { sessionId: string; event: import("../../shared/modules/rules").RulesChannelEvent }) => {
        if (payload.sessionId !== id) return;
        useRulesStore.getState().handleRulesEvent(id, payload.event);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        rulesSubscriptions: { ...s.rulesSubscriptions, [id]: subId },
      }));
      const store = useRulesStore.getState();
      const sessionState = store.bySession[id];
      if (!sessionState || sessionState.totalRules === 0) {
        apiClient.call("rules.requestSnapshot", { sessionId: id }).then((raw: unknown) => {
          const result = raw && typeof raw === "object" && "result" in raw ? (raw as Record<string, unknown>).result : raw;
          if (result && typeof result === "object" && "type" in result && result.type === "snapshot") {
            useRulesStore.getState().handleRulesEvent(id, result as import("../../shared/modules/rules").RulesChannelEvent);
          }
        }).catch(() => {});
      }
    }).catch(() => {});
  }

  if (!notifySubscriptions[id]) {
    apiClient.subscribe(
      "agent.notify",
      (payload: { sessionId: string; message: string; notifyType: "info" | "warning" | "error" }) => {
        if (payload.sessionId !== id) return;

        notificationGateway.emit({
          type: "agent_notify",
          sessionId: payload.sessionId,
          title: payload.message,
          body: "",
          level: payload.notifyType,
        });
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        notifySubscriptions: { ...s.notifySubscriptions, [id]: subId },
      }));
    }).catch(() => {});
  }

  if (!memorySubscriptions[id] || memorySubscriptions[id].length === 0) {
    const projectTab = useSessionStore.getState().projectTabs.find((t) => t.id === useSessionStore.getState().activeProjectId);
    const memorySubIds: string[] = [];

    function trackSub(promise: Promise<string>) {
      promise.then((subId) => {
        memorySubIds.push(subId);
        set((s) => ({
          memorySubscriptions: { ...s.memorySubscriptions, [id]: [...memorySubIds] },
        }));
      }).catch(() => {});
    }

    trackSub(apiClient.subscribe(
      "memory.bookmark_creating",
      (payload: { sessionId: string; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        const memStore = useMemoryStore.getState();
        memStore.addEvent(id, {
          id: `mem-creating-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customType: "bookmark_creating",
          data: payload,
          timestamp: payload.timestamp || Date.now(),
        });
        memStore.setBookmarkCreating(id, true);

      },
      { sessionId: id },
    ));

    trackSub(apiClient.subscribe(
      "memory.updated",
      (payload: { sessionId: string; files: Array<{ filename: string; filePath: string; description: string | null; type: string | null; mtimeMs: number }>; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        const memStore = useMemoryStore.getState();
        memStore.addEvent(id, {
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customType: "memory_updated",
          data: payload,
          timestamp: payload.timestamp,
        });
        memStore.setBookmarkCreating(id, false);
        if (projectTab) {
          memStore.loadFiles(projectTab.path, id);
        }

      },
      { sessionId: id },
    ));

    trackSub(apiClient.subscribe(
      "memory.update_failed",
      (payload: { sessionId: string; reason: string; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        const memStore = useMemoryStore.getState();
        memStore.addEvent(id, {
          id: `mem-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customType: "memory_update_failed",
          data: payload,
          timestamp: payload.timestamp,
        });
        memStore.setBookmarkCreating(id, false);

      },
      { sessionId: id },
    ));

    const MEMORY_OPERATION_EVENTS = [
      "memory.memory_prefetch",
      "memory.memory_prefetch_result",
      "memory.memory_extract",
      "memory.memory_extract_result",
      "memory.memory_dream",
      "memory.memory_dream_result",
    ] as const;

    for (const eventName of MEMORY_OPERATION_EVENTS) {
      trackSub(apiClient.subscribe(
        eventName,
        (payload: { sessionId: string; timestamp?: number; [key: string]: unknown }) => {
          if (payload.sessionId !== id) return;
          const customType = eventName.replace("memory.", "");
          const timestamp = payload.timestamp || Date.now();
          const eventData = (({ sessionId: _s, timestamp: _t, ...rest }) => rest)(payload);

          const memStore = useMemoryStore.getState();
          memStore.addEvent(id, {
            id: `mem-${customType}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            customType,
            data: eventData,
            timestamp,
          });

          if (customType === "memory_prefetch_result") {
            const data = eventData as { summary?: string; snippet?: string };
            if (data) {
              memStore.addInjected(id, {
                summary: data.summary || "",
                snippet: data.snippet || "",
              });
            }
          }

        },
        { sessionId: id },
      ));
    }
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
      rulesSubscriptions: {},
      notifySubscriptions: {},
      memorySubscriptions: {},
      sessionReady: {},
      todosBySession: {},
      sessionContextMap: {},
      sessionStatusMap: {},
      queueBySession: {},
      currentModel: null,
      currentThinkingLevel: "medium",
      availableModels: [],
      projectStartFailed: {},
      projectStartError: {},
      _projectVersion: 0,

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
        const version = get()._projectVersion + 1;
        set({ activeProjectId: id, _projectVersion: version });
        const tabs = get().projectTabs;
        syncTabsToBackend(tabs, id);
        const tab = tabs.find((t) => t.id === id);
        if (!tab) return;

        const explorer = useExplorerStore.getState();
        explorer.setCurrentPath(tab.path);
        explorer.listRootDir();

        get().loadSessionsForProject(tab.path).then(async (sessions) => {
          if (version !== get()._projectVersion) return;

          set((s) => ({
            projectStartFailed: { ...s.projectStartFailed, [id]: false },
            projectStartError: { ...s.projectStartError, [id]: "" },
          }));

          if (sessions.length > 0) {
            const current = get().activeSessionId;
            const belongs = sessions.some((s) => s.sessionId === current);
            if (!belongs) {
              get().setActiveSession(sessions[0].sessionId);
            }
          } else {
            await get().createNewSession();
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

      setActiveSession: (id, force) => {
        const prevId = get().activeSessionId;
        if (!force && prevId === id) return;

        const sid = id ?? "";
        useRulesStore.getState().clearSession(sid);
        useMemoryStore.getState().clearSession(sid);
        useBashStore.getState().clearSession(sid);
        useLspStore.getState().clearSession(sid);

        set({
          activeSessionId: id,
          sessionReady: id ? { ...get().sessionReady, [id]: false } : get().sessionReady,
        });
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
          if (!session) {
            set((s) => {
              const projectId = s.activeProjectId;
              if (!projectId) return {};
              return {
                projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                projectStartError: { ...s.projectStartError, [projectId]: "Session metadata not found" },
              };
            });
            return;
          }
          setupSubscriptions(get(), set, id, session);

          const startPromise = apiClient.call("agent.start", {
            sessionId: id,
            projectPath: session.projectPath,
            sessionPath: session.sessionPath,
          });

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("agent.start timed out (30s)")), 30_000)
          );

          Promise.race([startPromise, timeoutPromise]).then((result) => {
            if (result.status === "already_running" || result.status === "started") {
              set((s) => {
                const projectId = s.activeProjectId;
                if (!projectId) return {};
                return {
                  projectStartFailed: { ...s.projectStartFailed, [projectId]: false },
                  projectStartError: { ...s.projectStartError, [projectId]: "" },
                };
              });
              set((s) => ({ sessionReady: { ...s.sessionReady, [id]: true } }));
              get().fetchInitialState(id);
              useChatStore.getState().loadSessionMessages(id, { sessionPath: session.sessionPath }).catch(() => {});
              if (result.status === "already_running") {
                apiClient.call("agent.replayHoldEvents", { sessionId: id }).catch(() => {});
              }
            } else {
              const projectId = get().activeProjectId;
              if (projectId) {
                set((s) => ({
                  projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                  projectStartError: { ...s.projectStartError, [projectId]: `Unexpected status: ${result.status}` },
                }));
              }
            }
          }).catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            useAppStore.getState().addLog(`agent.start failed: ${errMsg}`);
            set((s) => {
              const projectId = s.activeProjectId;
              if (!projectId) return {};
              return {
                projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                projectStartError: { ...s.projectStartError, [projectId]: errMsg },
              };
            });
          });
        }).catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          useAppStore.getState().addLog(`ensureSession failed: ${errMsg}`);
          set((s) => {
            const projectId = s.activeProjectId;
            if (!projectId) return {};
            return {
              projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
              projectStartError: { ...s.projectStartError, [projectId]: errMsg },
            };
          });
        });
      },

      retryActiveProject: () => {
        const { activeProjectId, activeSessionId, projectTabs, agentSubscriptions, subagentSubscriptions } = get();
        if (!activeProjectId) return;
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;

        const newAgentSubs = { ...agentSubscriptions };
        const newSubagentSubs = { ...subagentSubscriptions };
        if (activeSessionId) {
          delete newAgentSubs[activeSessionId];
          delete newSubagentSubs[activeSessionId];
        }

        set((s) => ({
          projectStartFailed: { ...s.projectStartFailed, [activeProjectId]: false },
          projectStartError: { ...s.projectStartError, [activeProjectId]: "" },
          agentSubscriptions: newAgentSubs,
          subagentSubscriptions: newSubagentSubs,
        }));

        if (activeSessionId) {
          get().setActiveSession(activeSessionId, true);
        } else {
          const sessions = get().sessionsByProject[tab.path];
          if (sessions && sessions.length > 0) {
            get().setActiveSession(sessions[0].sessionId, true);
          }
        }
      },

      createNewSession: async (projectPath?: string) => {
        const { projectTabs, activeProjectId } = get();
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;

        const targetPath = projectPath ?? tab.path;

        try {
          const result = await apiClient.call("session.create", { projectPath: targetPath });

          const now = Date.now();
          const newSession: SessionMeta = {
            sessionId: result.sessionId,
            name: "",
            sessionPath: result.sessionPath,
            projectPath: targetPath,
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
              [targetPath]: [newSession, ...(s.sessionsByProject[targetPath] || [])],
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
        useTurnStore.getState().clearSessionUI(sessionId);
        useChatNavStore.getState().clearSessionUI(sessionId);
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

          apiClient.call("agent.getExtensions", { sessionId }).then((res) => {
            const exts = (res as Record<string, unknown>)?.extensions ?? res;
            if (!Array.isArray(exts)) return;
            const plugins = (exts as Array<Record<string, unknown>>).map((e) => ({
              name: (e.path as string)?.split("/").pop()?.replace(/\.(ts|js|tsx|jsx)$/, "") ?? "unknown",
              path: (e.path as string) ?? "",
              enabled: true,
              toolNames: e.toolNames as string[] ?? [],
              commandNames: e.commandNames as string[] ?? [],
            }));
            useStatusStore.getState().setPlugins(plugins);
          }).catch(() => {});

          apiClient.call("agent.getSkills", { sessionId }).then((res) => {
            const skills = (res as Record<string, unknown>)?.skills ?? res;
            if (!Array.isArray(skills)) {
              useAppStore.getState().addLog(`[skills] non-array response, type=${typeof skills}, isArray=${Array.isArray(res)}`);
              return;
            }
            useAppStore.getState().addLog(`[skills] loaded ${skills.length} items`);
            useStatusStore.getState().setSkills((skills as Array<Record<string, unknown>>).map((s) => {
              const fp = s.filePath as string ?? "";
              return {
                name: s.name as string ?? "",
                description: s.description as string ?? "",
                filePath: fp,
                baseDir: s.baseDir as string ?? "",
                disableModelInvocation: s.disableModelInvocation as boolean ?? false,
                enabled: true,
                scope: deriveSkillScope(fp),
              };
            }));
          }).catch((err) => {
            useAppStore.getState().addLog(`[skills] call failed: ${err instanceof Error ? err.message : String(err)}`);
          });

          apiClient.call("agent.getQueue", { sessionId }).then((result) => {
            if (!result) return;
            const q = result as { steering?: unknown[]; followUp?: unknown[] };
            const steering = (Array.isArray(q.steering) ? q.steering : []) as string[];
            const followUp = (Array.isArray(q.followUp) ? q.followUp : []) as string[];
            if (steering.length > 0 || followUp.length > 0) {
              useSessionStore.setState((s) => ({
                queueBySession: {
                  ...s.queueBySession,
                  [sessionId]: { steering, followUp },
                },
              }));
            }
          }).catch(() => {});
        }).catch(() => {});

        get().fetchModelState(sessionId);
      },

      fetchModelState: (sessionId) => {
        Promise.all([
          apiClient.call("agent.getState", { sessionId }),
          apiClient.call("agent.getAvailableModels", { sessionId }),
        ]).then(([stateResult, modelsResult]) => {
          if (stateResult?.model) {
            set({
              currentModel: { provider: stateResult.model.provider || "", id: stateResult.model.id, name: stateResult.model.name },
              currentThinkingLevel: stateResult.thinkingLevel || "medium",
            });
          }
          if (Array.isArray(modelsResult)) {
            set({ availableModels: modelsResult });
          }
        }).catch(() => {});
      },

      setCurrentModel: (provider, modelId) => set({ currentModel: { provider, id: modelId } }),
      setThinkingLevel: (level) => set({ currentThinkingLevel: level }),

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
          const targetId = found ? activeSessionId : (sessions.length > 0 ? sessions[0].sessionId : null);
          if (!targetId) return false;

          set({ activeSessionId: null });
          get().setActiveSession(targetId);

          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              resolve();
            }, 10000);
            const check = () => {
              if (useSessionStore.getState().sessionReady[targetId]) {
                clearTimeout(timeout);
                resolve();
              } else {
                setTimeout(check, 50);
              }
            };
            setTimeout(check, 50);
          });

          return true;
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
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<SessionState>),
        projectStartFailed: current.projectStartFailed,
        projectStartError: current.projectStartError,
        _projectVersion: current._projectVersion,
        agentSubscriptions: current.agentSubscriptions,
        subagentSubscriptions: current.subagentSubscriptions,
        todoSubscriptions: current.todoSubscriptions,
        bashSubscriptions: current.bashSubscriptions,
        lspSubscriptions: current.lspSubscriptions,
        rulesSubscriptions: current.rulesSubscriptions,
        notifySubscriptions: current.notifySubscriptions,
        memorySubscriptions: current.memorySubscriptions,
        sessionReady: current.sessionReady,
      }),
      onRehydrateStorage: () => () => {},
    }
  )
);

apiClient.onReconnect(() => {
  const state = useSessionStore.getState();
  const { activeSessionId, projectTabs, activeProjectId } = state;

  useSessionStore.setState({
    agentSubscriptions: {},
    subagentSubscriptions: {},
    todoSubscriptions: {},
    bashSubscriptions: {},
    lspSubscriptions: {},
    rulesSubscriptions: {},
    notifySubscriptions: {},
    memorySubscriptions: {},
    sessionReady: {},
  });

  if (!activeSessionId || !activeProjectId) return;
  const tab = projectTabs.find((t) => t.id === activeProjectId);
  if (!tab) return;

  const sessions = state.sessionsByProject[tab.path];
  const session = sessions?.find((s) => s.sessionId === activeSessionId);
  if (session) {
    const storeGet = useSessionStore.getState.bind(useSessionStore);
    const storeSet = (fn: (s: SessionState) => Partial<SessionState>) =>
      useSessionStore.setState(fn(useSessionStore.getState()));

    setupSubscriptions(useSessionStore.getState(), storeSet, activeSessionId, session);

    apiClient.call("agent.start", {
        sessionId: activeSessionId,
        projectPath: session.projectPath,
        sessionPath: session.sessionPath,
      }).then((result) => {
        if (result.status === "already_running" || result.status === "started") {
          useSessionStore.setState((s) => {
            const projectId = s.activeProjectId;
            if (!projectId) return {};
            return {
              projectStartFailed: { ...s.projectStartFailed, [projectId]: false },
              projectStartError: { ...s.projectStartError, [projectId]: "" },
            };
          });
          useSessionStore.setState((s) => ({ sessionReady: { ...s.sessionReady, [activeSessionId]: true } }));
          storeGet().fetchInitialState(activeSessionId);
          useChatStore.getState().loadSessionMessages(activeSessionId, { sessionPath: session.sessionPath }).catch(() => {});
          if (result.status === "already_running") {
            apiClient.call("agent.replayHoldEvents", { sessionId: activeSessionId }).catch(() => {});
          }
        }
      }).catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        useAppStore.getState().addLog(`reconnect agent.start failed: ${errMsg}`);
        useSessionStore.setState((s) => {
          const projectId = s.activeProjectId;
          if (!projectId) return {};
          return {
            projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
            projectStartError: { ...s.projectStartError, [projectId]: errMsg },
          };
        });
      });
  }
});

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
    notificationGateway.emit({
      type: "session_complete",
      sessionId,
      title: "会话完成",
      body: `会话 ${sessionId.slice(0, 8)}... 执行完毕`,
      level: "info",
    });
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
    useChatStore.getState().loadSessionMessages(sessionId, { force: true });
    return;
  }

  if (event.type === "auto_retry_start") {
    storeGet().updateSessionStatus(sessionId, "retrying");
    useRetryStore.getState().startRetry(sessionId, {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage,
    });
    notificationGateway.emit({
      type: "retry_start",
      sessionId,
      title: "自动重试",
      body: `第 ${event.attempt}/${event.maxAttempts} 次重试`,
      level: "warning",
    });
    return;
  }

  if (event.type === "auto_retry_end") {
    useRetryStore.getState().endRetry(sessionId);
    notificationGateway.emit({
      type: event.success ? "retry_success" : "retry_failed",
      sessionId,
      title: event.success ? "重试成功" : "重试失败",
      body: event.success ? "会话已恢复执行" : (event.finalError ?? "已达最大重试次数"),
      level: event.success ? "info" : "error",
    });
    const current = storeGet().sessionStatusMap[sessionId];
    if (current === "retrying") {
      storeGet().updateSessionStatus(sessionId, "streaming");
    }
    return;
  }

  if (event.type === "extension_ui_request") {
    if (event.method === "confirm" || event.method === "select" || event.method === "input") {
      storeGet().updateSessionStatus(sessionId, "permission");
      notificationGateway.emit({
        type: "permission_request",
        sessionId,
        title: "权限请求",
        body: "Agent 需要你的确认",
        level: "warning",
      });
    }
    return;
  }

  if (event.type === "message_start") {
    const raw = event.message;
    const msgObj = typeof raw === "object" && raw !== null ? raw as unknown as Record<string, unknown> : null;
    const role = msgObj && typeof msgObj.role === "string" ? msgObj.role : "";

    if (role === "custom") {
      const customType = typeof (msgObj as Record<string, unknown>).customType === "string"
        ? (msgObj as Record<string, unknown>).customType as string : "unknown";

      const data = "details" in (msgObj as Record<string, unknown>)
        ? (msgObj as Record<string, unknown>).details
        : "data" in (msgObj as Record<string, unknown>)
          ? (msgObj as Record<string, unknown>).data
          : {};

      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const customMsg: import("../types").ChatMessage = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "custom",
        content: [{ type: "custom", customType, data }],
        timestamp: Date.now(),
      };
      chat.setMessagesForSession(sessionId, [...existing, customMsg]);
      return;
    }

    if (role === "user") {
      const msg = messageToChatMessage(raw);
      if (msg) {
        const chat = useChatStore.getState();
        const existing = chat.messagesBySession[sessionId] || [];
        const localIdx = existing.findIndex((m) => m.role === "user" && m._local);
        if (localIdx >= 0) {
          const updated = [...existing];
          updated[localIdx] = { ...msg };
          chat.setMessagesForSession(sessionId, updated);
        } else {
          chat.setMessagesForSession(sessionId, [...existing, msg]);
        }
      }
      return;
    }

    if (role !== "assistant") return;

    const msg = messageToChatMessage(raw, undefined, toolCallNameMap);

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const lastMsg = existing[existing.length - 1];

    if (lastMsg && lastMsg.role === "assistant" && lastMsg.isStreaming === true) {
      const content = msg ? msg.content.map((b) => {
        if (b.type === "toolCall") {
          const args = typeof b.input === "string" ? b.input : b.input != null ? JSON.stringify(b.input, null, 2) : "";
          return { type: "toolExecution" as const, toolCallId: b.id, toolName: b.name, args, status: "running" as const };
        }
        return b;
      }) : lastMsg.content;
      chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), { ...lastMsg, content, isStreaming: true }]);
    } else if (msg) {
      msg.content = msg.content.map((b) => {
        if (b.type === "toolCall") {
          const args = typeof b.input === "string" ? b.input : b.input != null ? JSON.stringify(b.input, null, 2) : "";
          return { type: "toolExecution" as const, toolCallId: b.id, toolName: b.name, args, status: "running" as const };
        }
        return b;
      });
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

      const message = event.message as AssistantMessage;
      const incoming = message.content;
      if (!incoming || !Array.isArray(incoming)) return;

      if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.isStreaming) {
        const synthMsg: import("../types").ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "assistant",
          content: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        chat.setMessagesForSession(sessionId, [...existing, synthMsg]);
      }

      const currentMsgs = chat.messagesBySession[sessionId] || [];
      const currentLast = currentMsgs[currentMsgs.length - 1];

      const preservedToolExecs = (currentLast?.content || []).filter((b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution");
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
          } else {
            const rawArgs = ("arguments" in block ? block.arguments : undefined) ?? ("input" in block ? (block as unknown as { input?: unknown }).input : undefined);
            const args = typeof rawArgs === "string"
              ? rawArgs
              : rawArgs != null ? JSON.stringify(rawArgs, null, 2) : "";
            const toolName = ("name" in block && typeof block.name === "string") ? block.name : "unknown";
            otherBlocks.push({
              type: "toolExecution",
              toolCallId: block.id,
              toolName,
              args,
              status: "running",
            });
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

      chat.setMessagesForSession(sessionId, [...currentMsgs.slice(0, -1), {
        ...currentLast,
        content: [...otherBlocks, ...textBlocks],
        ...buildTokenUsage(message.usage),
        ...(message.stopReason ? { stopReason: message.stopReason } : {}),
      }]);
      chat.incrementStreamVersion();
    });
    return;
  }

	if (event.type === "message_end") {
		const entryId = (event as Record<string, unknown>).entryId as string | undefined;
		const message = event.message as unknown as Record<string, unknown>;
		const role = typeof message.role === "string" ? message.role : "";

		if (role === "user" && entryId) {
			const chat = useChatStore.getState();
			const existing = chat.messagesBySession[sessionId] || [];
			const userMsg = existing.find((m) => m.role === "user" && !m.entryId);
			if (userMsg) {
				chat.setMessagesForSession(sessionId, existing.map((m) =>
					m.id === userMsg.id ? { ...m, entryId } : m
				));
			}
			return;
		}

		if (role !== "assistant") return;
		const chat = useChatStore.getState();
		const existing = chat.messagesBySession[sessionId] || [];
		const lastMsg = existing[existing.length - 1];
		if (!lastMsg || lastMsg.role !== "assistant") return;

		if (message.usage) {
			const raw = message.usage as unknown as Record<string, unknown>;
			const totalTokens = Number(raw.totalTokens ?? 0);
			if (totalTokens > 0) {
				storeGet().updateSessionContext(sessionId, { tokens: totalTokens });
			}
		}

		flushNow();

		const hasContent = lastMsg.content.some(
			(b) => (b.type === "text" && b.text.trim().length > 0)
				|| b.type === "thinking"
				|| b.type === "toolCall"
				|| b.type === "toolResult"
				|| b.type === "toolExecution"
				|| b.type === "custom",
		);

		if (!hasContent) {
			chat.setMessagesForSession(sessionId, existing.slice(0, -1));
			return;
		}

		chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {
			...lastMsg,
			isStreaming: false,
			stopReason: (message as Record<string, unknown>).stopReason as string | null | undefined ?? lastMsg.stopReason ?? null,
			provider: ((message as Record<string, unknown>).provider as string | undefined) || lastMsg.provider,
			model: ((message as Record<string, unknown>).model as string | undefined) || lastMsg.model,
			...buildTokenUsage((message as Record<string, unknown>).usage as Record<string, unknown> | undefined),
			entryId,
		}]);
		return;
	}

		if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
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
					if (targetIdx >= 0) {
						blocks[targetIdx] = { type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" };
					} else {
						blocks.push({ type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" });
					}
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
				}

				const updated = [...existing];
				updated[existing.length - 1] = { ...lastMsg, content: blocks };
				chat.setMessagesForSession(sessionId, updated);
				chat.incrementStreamVersion();
			});
    return;
  }

  if (event.type === "tool_execution_end") {
    flushNow();
    const toolCallId = event.toolCallId;
    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];

    for (let i = existing.length - 1; i >= 0; i--) {
      const msg = existing[i];
      if (msg.role !== "assistant") continue;
      const blockIdx = msg.content.findIndex((b): b is ToolExecBlock =>
        b.type === "toolExecution" && b.toolCallId === toolCallId
      );
      if (blockIdx < 0) continue;

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

      const blocks = [...msg.content];
      const prev = blocks[blockIdx] as ToolExecBlock;
      blocks[blockIdx] = { ...prev, status: isError ? "error" : "done", output, details: result?.details };

      const updated = [...existing];
      updated[i] = { ...msg, content: blocks };
      chat.setMessagesForSession(sessionId, updated);
      chat.incrementStreamVersion();
      return;
    }

    return;
  }

  if (event.type === "custom_entry") {
    if (!ALL_MEMORY_TYPE_KEYS.has(event.customType as string)) return;

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

    if (event.display === false) return;

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const customMsg: import("../types").ChatMessage = {
      id: event.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "custom",
      content: [{ type: "custom", customType: event.customType, data: event.data }],
      timestamp: Date.now(),
    };
    chat.setMessagesForSession(sessionId, [...existing, customMsg]);

    return;
  }

  if (event.type === "session_rename") {
    const { newName } = event;
    useSessionStore.setState((s) => {
      const updated: Record<string, import("../types").SessionMeta[]> = {};
      for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
        updated[path] = (sessions as import("../types").SessionMeta[]).map((sess) =>
          sess.sessionId === sessionId ? { ...sess, name: newName } : sess,
        );
      }
      return { sessionsByProject: updated };
    });
    return;
  }

  if (event.type === "queue_update") {
    useSessionStore.setState((s) => ({
      queueBySession: {
        ...s.queueBySession,
        [sessionId]: { steering: event.steering, followUp: event.followUp },
      },
    }));
    return;
  }
}

function buildTokenUsage(usage: unknown): { tokenUsage?: import("../types").TokenUsage } {
  const result = extractTokenUsage(usage);
  return result ? { tokenUsage: result } : {};
}

if (typeof window !== "undefined") {
  (window as any).__toolCallNameMap = toolCallNameMap;
}
