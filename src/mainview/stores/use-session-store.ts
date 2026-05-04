import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionMeta, ProjectTab, ContextUsage, SessionStatus } from "../types";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";
import { useChatStore } from "./use-chat-store";
import { useAppStore } from "./use-app-store";
import { useExplorerStore } from "./use-explorer-store";
import { useStatusStore, deriveSkillScope, derivePluginScope } from "./use-status-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { setupSubscriptions, cleanupSession, cleanupSessionData, clearSubscriptionState, syncTabsToBackend } from "./session-subscriptions";
import type { TodoItem } from "./session-subscriptions";

export type { TodoItem, TodoPriority } from "./session-subscriptions";

const log = createLogger("session");

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
}

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
  reorderProjectTabs: (fromIndex: number, toIndex: number) => void;
  setActiveProject: (id: string) => void;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  setActiveSession: (id: string | null, force?: boolean) => void;
  retryActiveProject: () => void;
  createNewSession: (projectPath?: string) => Promise<void>;
  updateSessionProjectPath: (sessionId: string, projectPath: string) => void;
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
  cleanupActiveSession: (sessionId: string) => void;
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

      removeProjectTab: (id) => {
        const state = get();
        if (state.activeProjectId === id && state.activeSessionId) {
          const sid = state.activeSessionId;
          cleanupSession(state, sid);
          cleanupSessionData(sid);
          set((s) => clearSubscriptionState(s, sid));
        }

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
        });
      },

      reorderProjectTabs: (fromIndex: number, toIndex: number) => {
        set((s) => {
          const tabs = [...s.projectTabs];
          const [moved] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, moved);
          syncTabsToBackend(tabs, s.activeProjectId);
          return { projectTabs: tabs };
        });
      },

      setActiveProject: (id) => {
        const prevProjectId = get().activeProjectId;
        const prevSessionId = get().activeSessionId;

        if (prevProjectId && prevProjectId !== id && prevSessionId) {
          cleanupSession(get(), prevSessionId);
          cleanupSessionData(prevSessionId);
          set((s) => clearSubscriptionState(s, prevSessionId));
        }

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

        if (prevId && prevId !== id) {
          cleanupSession(get(), prevId);
          cleanupSessionData(prevId);
          set((s) => clearSubscriptionState(s, prevId));
        }

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
          if (get().activeSessionId !== id) return;
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
              log.info("agent.start result", { status: result.status, sessionId: id });
              set((s) => ({ sessionReady: { ...s.sessionReady, [id]: true } }));
              get().fetchInitialState(id);

              const replayPromise = result.status === "already_running"
                ? apiClient.call("agent.replayHoldEvents", { sessionId: id }).then((r) => {
                    log.info("replayHoldEvents replayed", { replayed: (r as Record<string, unknown>).replayed });
                  }).catch((err) => { log.warn("replayHoldEvents failed", { sessionId: id, err: err instanceof Error ? err.message : String(err) }); })
                : Promise.resolve();

              replayPromise.then(() => {
                useChatStore.getState().loadSessionMessages(id, { sessionPath: session.sessionPath }).then(() => {
                  log.info("loadSessionMessages done", { sessionId: id, count: useChatStore.getState().messagesBySession[id]?.length });
                }).catch((e) => {
                  log.error("loadSessionMessages FAILED", { error: e instanceof Error ? e.message : String(e) });
                });
              });
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
        if (!tab) {
          log.error("createNewSession: no active tab");
          return;
        }

        const targetPath = projectPath ?? tab.path;
        log.info("Creating session", { targetPath });

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
              [tab.path]: [newSession, ...(s.sessionsByProject[tab.path] || [])],
            },
          }));

          get().setActiveSession(result.sessionId);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          log.error("Failed to create session", { error: errMsg });
          useAppStore.getState().addLog(`Failed to create session: ${errMsg}`);
        }
      },

      updateSessionProjectPath: (sessionId, projectPath) => {
        let sessionPath = "";
        set((s) => {
          const updated: Record<string, SessionMeta[]> = {};
          for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
            updated[path] = sessions.map((sess) => {
              if (sess.sessionId === sessionId) {
                sessionPath = sess.sessionPath;
                return { ...sess, projectPath };
              }
              return sess;
            });
          }
          return { sessionsByProject: updated };
        });
        if (sessionPath) {
          apiClient.call("session.updateCwd", { sessionPath, newCwd: projectPath }).catch((err) => { log.warn("session.updateCwd failed", { err: err instanceof Error ? err.message : String(err) }); });
        }
        apiClient.call("agent.setCwd", { sessionId, cwd: projectPath }).catch((err) => { log.warn("agent.setCwd failed", { err: err instanceof Error ? err.message : String(err) }); });
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
          apiClient.call("session.rename", { sessionId, sessionPath, newName }).catch((err) => { log.warn("session.rename failed", { err: err instanceof Error ? err.message : String(err) }); });
        }
      },

      deleteSession: (sessionId) => {
        cleanupSession(get(), sessionId);
        cleanupSessionData(sessionId);
        set((s) => clearSubscriptionState(s, sessionId));

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
          apiClient.call("session.delete", { sessionId, sessionPath: deletedSessionPath }).catch((err) => { log.warn("session.delete failed", { err: err instanceof Error ? err.message : String(err) }); });
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
          apiClient.call("session.unpin", { sessionId }).catch((err) => { log.warn("session.unpin failed", { err: err instanceof Error ? err.message : String(err) }); });
        } else {
          apiClient.call("session.pin", { sessionId }).catch((err) => { log.warn("session.pin failed", { err: err instanceof Error ? err.message : String(err) }); });
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
        Promise.all([
          apiClient.call("agent.getState", { sessionId }),
          apiClient.call("agent.getAvailableModels", { sessionId }),
        ]).then(([result, modelsResult]) => {
          if (!result) return;

          const cw = result.model?.contextWindow ?? 0;
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

          if (result.model) {
            set({
              currentModel: { provider: result.model.provider ?? "", id: result.model.id, name: result.model.name },
              currentThinkingLevel: result.thinkingLevel ?? "medium",
            });
          }
          if (Array.isArray(modelsResult)) {
            set({ availableModels: modelsResult });
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
          }).catch((err) => { log.warn("agent.getSessionStats failed", { sessionId, err: err instanceof Error ? err.message : String(err) }); });

          apiClient.call("agent.getExtensions", { sessionId }).then((res) => {
            const exts = Array.isArray(res) ? res : res.extensions;
            if (!Array.isArray(exts)) return;
            const plugins = exts.map((e) => {
              const parts = e.path.split("/");
              const fileName = parts.pop()?.replace(/\.(ts|js|tsx|jsx)$/, "") ?? "unknown";
              const dirName = parts.pop() ?? fileName;
              const name = fileName === "index" ? dirName : fileName;
              return {
                name,
                path: e.path,
                enabled: true,
                toolNames: e.toolNames,
                commandNames: e.commandNames,
                scope: derivePluginScope(e.path),
              };
            });
            useStatusStore.getState().setPlugins(plugins);
          }).catch((err) => { log.warn("agent.getExtensions failed", { sessionId, err: err instanceof Error ? err.message : String(err) }); });

          Promise.all([
            apiClient.call("agent.getSkills", { sessionId }),
            apiClient.call("agent.getDisabledSkills", {}),
          ]).then(([skillsRes, disabledRes]) => {
            const skillsArr = Array.isArray(skillsRes) ? skillsRes : skillsRes?.skills;
            if (!Array.isArray(skillsArr)) {
              useAppStore.getState().addLog(`[skills] non-array response, type=${typeof skillsRes}`);
              return;
            }
            const disabledSet = new Set(disabledRes?.disabledSkills ?? []);
            useAppStore.getState().addLog(`[skills] loaded ${skillsArr.length} items, ${disabledSet.size} disabled`);
            useStatusStore.getState().setSkills(skillsArr.map((s) => {
              const fp = s.filePath;
              const scope: "global" | "project" = s.sourceInfo?.scope === "user" ? "global" : deriveSkillScope(fp);
              return {
                name: s.name,
                description: s.description,
                filePath: fp,
                baseDir: s.baseDir,
                disableModelInvocation: s.disableModelInvocation,
                enabled: !disabledSet.has(s.name),
                scope,
              };
            }));
          }).catch((err) => {
            useAppStore.getState().addLog(`[skills] call failed: ${err instanceof Error ? err.message : String(err)}`);
          });

          apiClient.call("agent.getQueue", { sessionId }).then((result) => {
            if (!result) return;
            const { steering, followUp } = result;
            if (steering.length > 0 || followUp.length > 0) {
              useSessionStore.setState((s) => ({
                queueBySession: {
                  ...s.queueBySession,
                  [sessionId]: { steering, followUp },
                },
              }));
            }
          }).catch((err) => { log.warn("agent.getQueue failed", { sessionId, err: err instanceof Error ? err.message : String(err) }); });
        }).catch((err) => { log.warn("agent.getSkills/getDisabledSkills failed", { sessionId, err: err instanceof Error ? err.message : String(err) }); });
      },

      fetchModelState: (sessionId) => {
        apiClient.call("agent.getAvailableModels", { sessionId }).then((modelsResult) => {
          if (Array.isArray(modelsResult)) {
            set({ availableModels: modelsResult });
          }
        }).catch((err) => { log.warn("agent.getAvailableModels failed", { sessionId, err: err instanceof Error ? err.message : String(err) }); });
      },

      setCurrentModel: (provider, modelId) => set({ currentModel: { provider, id: modelId } }),
      setThinkingLevel: (level) => set({ currentThinkingLevel: level }),

      cleanupActiveSession: (sessionId) => {
        cleanupSession(get(), sessionId);
        cleanupSessionData(sessionId);
        set((s) => clearSubscriptionState(s, sessionId));
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
          const targetId = found ? activeSessionId : (sessions.length > 0 ? sessions[0].sessionId : null);
          if (!targetId) return false;

          set({ activeSessionId: null });
          get().setActiveSession(targetId);

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
  log.info("[onReconnect] triggered");
  const state = useSessionStore.getState();
  const { activeSessionId, projectTabs, activeProjectId } = state;

  if (!activeSessionId || !activeProjectId) return;
  const tab = projectTabs.find((t) => t.id === activeProjectId);
  if (!tab) return;

  const sessions = state.sessionsByProject[tab.path];
  const session = sessions?.find((s) => s.sessionId === activeSessionId);
  if (!session) return;

  const storeGet = useSessionStore.getState.bind(useSessionStore);
  const storeSet = (fn: (s: SessionState) => Partial<SessionState>) =>
    useSessionStore.setState(fn(useSessionStore.getState()));

  for (const sid of Object.keys(state.agentSubscriptions)) {
    cleanupSession(state, sid);
  }

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
        if (result.status === "already_running") {
          apiClient.call("agent.replayHoldEvents", { sessionId: activeSessionId }).catch((err) => { log.warn("agent.replayHoldEvents failed", { sessionId: activeSessionId, err: err instanceof Error ? err.message : String(err) }); });
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
});
