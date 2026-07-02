import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SessionMeta,
  ProjectTab,
  ContextUsage,
  SessionStatus,
  SessionUsageStats,
} from "../types";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";
import { useNotificationStore } from "./use-notification-store";
import { useTierStore } from "./use-tier-store";
import { useChatStore } from "./use-chat-store";
import { useAppStore } from "./use-app-store";
import { useExplorerStore } from "./use-explorer-store";
import { useGitStore } from "./use-git-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { useSubagentStore, clearSubagentToolNames } from "./use-subagent-store";
import { createFetchInitialStateAction } from "./session-initial-state";
import { createSetActiveSessionAction, runReconnectMessageLoad } from "./session-active-session";
import { formatProjectStartError, getErrorMessage } from "./session-start-error";
import {
  createCreateNewSessionAction,
  createLoadSessionsForProjectAction,
} from "./session-project-actions";
import {
  createRenameSessionAction,
  createRetryActiveProjectAction,
  createUpdateSessionProjectPathAction,
} from "./session-simple-actions";
import {
  setupSubscriptions,
  cleanupSession,
  cleanupSessionLight,
  cleanupSessionData,
  clearSubscriptionState,
  syncTabsToBackend,
  requestRulesSnapshot,
} from "./session-subscriptions";
import { useSessionTodoStore } from "./use-session-todo-store";
import { useSessionQueueStore } from "./use-session-queue-store";
import { pickDefaultSessionId } from "./session-selection";
import { getProjectWorkspacePath } from "../lib/project-workspace-path";

const log = createLogger("session");
const perfLog = createLogger("session-perf");

const _statusWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
const _resourceRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const _modelStatePromises = new Map<string, Promise<void>>();
const STATUS_STUCK_TIMEOUT_MS = 30 * 60 * 1000;

export function clearStatusWatchdog(sessionId: string) {
  const watchdog = _statusWatchdogs.get(sessionId);
  if (watchdog) {
    clearTimeout(watchdog);
    _statusWatchdogs.delete(sessionId);
  }
}

function clearResourceRefreshTimer(sessionId: string): void {
  const timer = _resourceRefreshTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    _resourceRefreshTimers.delete(sessionId);
  }
}

function findSessionProjectPath(state: SessionState, sessionId: string): string | null {
  for (const sessions of Object.values(state.sessionsByProject)) {
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (session?.projectPath) return session.projectPath;
  }
  return null;
}

function getActiveTabPath(state: SessionState): string | null {
  const tab = state.projectTabs.find((item) => item.id === state.activeProjectId);
  return getProjectWorkspacePath(tab) || null;
}

function mergeProjectTab(existing: ProjectTab, incoming: ProjectTab): ProjectTab {
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    runtime: incoming.runtime ?? existing.runtime,
    remote: incoming.remote ?? existing.remote,
    connected: incoming.connected ?? existing.connected,
  };
}

async function resolveReconnectTab(
  state: SessionState,
): Promise<{ state: SessionState; tab: ProjectTab } | null> {
  if (!state.activeProjectId) return null;
  const existingTab = state.projectTabs.find((t) => t.id === state.activeProjectId);
  if (existingTab) return { state, tab: existingTab };

  try {
    const restored = (await apiClient.call("project.restoreTabs", {})) as {
      tabs?: ProjectTab[];
      activeTabId?: string | null;
    };
    const tabs = restored.tabs ?? [];
    const activeProjectId =
      (restored.activeTabId && tabs.some((tab) => tab.id === restored.activeTabId)
        ? restored.activeTabId
        : null) ??
      (tabs.some((tab) => tab.id === state.activeProjectId) ? state.activeProjectId : null) ??
      tabs[0]?.id ??
      null;

    if (!activeProjectId) return null;

    useSessionStore.setState({
      projectTabs: tabs,
      activeProjectId,
    });

    const nextState = useSessionStore.getState();
    const restoredTab = nextState.projectTabs.find((tab) => tab.id === activeProjectId);
    return restoredTab ? { state: nextState, tab: restoredTab } : null;
  } catch (err) {
    log.warn("[onReconnect] restoreTabs failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function scheduleWorkspaceResourceRefresh(getState: () => SessionState, sessionId: string): void {
  const existing = _resourceRefreshTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    _resourceRefreshTimers.delete(sessionId);

    const state = getState();
    if (state.activeSessionId !== sessionId) return;

    const explorer = useExplorerStore.getState();
    const tabPath = getActiveTabPath(state);
    const sessionPath = findSessionProjectPath(state, sessionId);
    const refreshPath = explorer.currentPath ?? sessionPath ?? tabPath;
    if (!refreshPath) return;

    if (explorer.currentPath && typeof explorer.listRootDir === "function") {
      void explorer.listRootDir();
    }
    const git = useGitStore.getState();
    if (typeof git.refreshAll === "function") {
      void git.refreshAll(refreshPath);
    }
  }, 300);

  _resourceRefreshTimers.set(sessionId, timer);
}

function clearActiveProjectStartErrorForSession(
  state: SessionState,
  sessionId: string,
): Partial<SessionState> {
  if (state.activeSessionId !== sessionId || !state.activeProjectId) return {};
  return {
    projectStartFailed: { ...state.projectStartFailed, [state.activeProjectId]: false },
    projectStartError: { ...state.projectStartError, [state.activeProjectId]: "" },
  };
}

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
}

type AvailableModel = {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  input: ("text" | "image")[];
};

/**
 * Insert a new session after the last pinned session.
 * Ensures new/forked sessions don't appear above pinned ones.
 */
export function insertAfterPinned(sessions: SessionMeta[], newSession: SessionMeta): SessionMeta[] {
  const lastPinnedIdx = sessions.reduce((maxIdx, sess, idx) => (sess.pinned ? idx : maxIdx), -1);
  return [
    ...sessions.slice(0, lastPinnedIdx + 1),
    newSession,
    ...sessions.slice(lastPinnedIdx + 1),
  ];
}

interface SessionState {
  sessionsByProject: Record<string, SessionMeta[]>;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  activeProjectId: string | null;
  loading: boolean;
  agentSubscriptions: Record<string, string>;
  batchSubscriptions: Record<string, string>;
  subagentSubscriptions: Record<string, string>;
  todoSubscriptions: Record<string, string>;
  bashSubscriptions: Record<string, string>;
  lspSubscriptions: Record<string, string>;
  rulesSubscriptions: Record<string, string>;
  notifySubscriptions: Record<string, string>;
  memorySubscriptions: Record<string, string[]>;
  coordinatorSubscriptions: Record<string, string>;
  supervisorSubscriptions: Record<string, string>;
  sessionReady: Record<string, boolean>;
  agentReady: Record<string, boolean>;
  sessionContextMap: Record<string, ContextUsage>;
  sessionStatsMap: Record<string, SessionUsageStats>;
  sessionStatusMap: Record<string, SessionStatus>;
  currentModel: ModelInfo | null;
  modelBySession: Record<string, ModelInfo>;
  modelStateLoading: boolean;
  modelManuallySet: boolean;
  currentThinkingLevel: string;
  availableModels: AvailableModel[];
  availableModelsBySession: Record<string, AvailableModel[]>;
  modelFavorites: Set<string>;
  lastActiveSessionByProject: Record<string, string>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  _projectVersion: number;
  newSessionCreatedAt: number;

  addProjectTab: (tab: ProjectTab) => void;
  removeProjectTab: (id: string) => void;
  reorderProjectTabs: (fromIndex: number, toIndex: number) => void;
  setActiveProject: (id: string, options?: { skipAutoSession?: boolean }) => void;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  setActiveSession: (
    id: string | null,
    force?: boolean,
    options?: { skipCleanup?: boolean; forceNewProcess?: boolean },
  ) => void;
  retryActiveProject: () => void;
  createNewSession: (projectPath?: string) => Promise<void>;
  updateSessionProjectPath: (sessionId: string, projectPath: string) => void;
  renameSession: (sessionId: string, newName: string) => void;
  deleteSession: (sessionId: string) => void;
  togglePinSession: (sessionId: string) => void;
  restoreFromPersisted: () => Promise<boolean>;
  updateSessionContext: (sessionId: string, usage: Partial<ContextUsage>) => void;
  refreshSessionContext: (sessionId: string) => Promise<void>;
  updateSessionStats: (sessionId: string, stats: SessionUsageStats) => void;
  refreshSessionStats: (sessionId: string) => Promise<void>;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  restoreContextFromHistory: (sessionId: string) => void;
  fetchInitialState: (sessionId: string) => void;
  fetchModelState: (
    sessionId: string,
    options?: { force?: boolean; includeFavorites?: boolean },
  ) => Promise<void>;
  scheduleWorkspaceResourceRefresh: (sessionId: string) => void;
  refreshSessionResources: (sessionId: string) => void;
  setCurrentModel: (provider: string, modelId: string) => void;
  setThinkingLevel: (level: string) => void;
  fetchModelFavorites: () => void;
  toggleModelFavorite: (modelKey: string) => void;
  cleanupActiveSession: (sessionId: string) => void;
  fetchAllSessionStatuses: () => Promise<void>;
  fetchProjectSessionStatuses: (projectPath: string) => Promise<void>;
  refreshSessionsInBackground: (projectPath: string) => void;
  fetchSessionsStatusBatch: (sessionIds: string[]) => Promise<void>;
  fetchAllProjectsSessionsStatus: () => Promise<void>;
}

const _agentStartedSessions = new Set<string>();

export function markAgentStarted(sessionId: string) {
  _agentStartedSessions.add(sessionId);
}
function isAgentStarted(sessionId: string): boolean {
  return _agentStartedSessions.has(sessionId);
}
export function clearAgentStarted(sessionId: string) {
  _agentStartedSessions.delete(sessionId);
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessionsByProject: {},
      activeSessionId: null,
      projectTabs: [],
      activeProjectId: null,
      loading: true,
      agentSubscriptions: {},
      batchSubscriptions: {},
      subagentSubscriptions: {},
      todoSubscriptions: {},
      bashSubscriptions: {},
      lspSubscriptions: {},
      rulesSubscriptions: {},
      notifySubscriptions: {},
      memorySubscriptions: {},
      coordinatorSubscriptions: {},
      supervisorSubscriptions: {},
      sessionReady: {},
      agentReady: {},
      sessionContextMap: {},
      sessionStatsMap: {},
      sessionStatusMap: {},
      currentModel: null,
      modelBySession: {},
      modelStateLoading: false,
      modelManuallySet: false,
      currentThinkingLevel: "medium",
      availableModels: [],
      availableModelsBySession: {},
      modelFavorites: new Set<string>(),
      lastActiveSessionByProject: {},
      projectStartFailed: {},
      projectStartError: {},
      _projectVersion: 0,
      newSessionCreatedAt: 0,

      addProjectTab: (tab) =>
        set((s) => {
          const exists = s.projectTabs.find((t) => t.path === tab.path || t.id === tab.id);
          if (exists) {
            const next = s.projectTabs.map((existing) =>
              existing.id === exists.id ? mergeProjectTab(existing, tab) : existing,
            );
            syncTabsToBackend(next, exists.id);
            return { projectTabs: next, activeProjectId: exists.id };
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
          clearStatusWatchdog(sid);
          cleanupSession(state, sid);
          cleanupSessionData(sid);
          set((s) => clearSubscriptionState(s, sid));
        }

        const wasActive = state.activeProjectId === id;
        set((s) => {
          const filtered = s.projectTabs.filter((t) => t.id !== id);
          const newActiveId =
            s.activeProjectId === id
              ? (filtered[filtered.length - 1]?.id ?? null)
              : s.activeProjectId;
          syncTabsToBackend(filtered, newActiveId);
          return {
            projectTabs: filtered,
            activeProjectId: newActiveId,
          };
        });

        if (wasActive) {
          const newActiveId = get().activeProjectId;
          if (newActiveId) {
            get().setActiveProject(newActiveId);
          }
        }
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

      setActiveProject: (id, options?) => {
        const prevProjectId = get().activeProjectId;
        const prevSessionId = get().activeSessionId;
        const skipAutoSession = options?.skipAutoSession ?? false;

        if (prevProjectId && prevProjectId !== id && prevSessionId) {
          clearStatusWatchdog(prevSessionId);
          clearResourceRefreshTimer(prevSessionId);
          cleanupSession(get(), prevSessionId);
          cleanupSessionLight(prevSessionId);
          set((s) => clearSubscriptionState(s, prevSessionId));
          useGitStore.getState().clearDiff();
        }

        const version = get()._projectVersion + 1;
        set({ activeProjectId: id, activeSessionId: null, _projectVersion: version });
        const tabs = get().projectTabs;
        syncTabsToBackend(tabs, id);
        const tab = tabs.find((t) => t.id === id);
        if (!tab) return;
        const workspacePath = getProjectWorkspacePath(tab);

        const explorer = useExplorerStore.getState();
        explorer.setCurrentPath(workspacePath);
        explorer.listRootDir();

        const gitStore = useGitStore.getState();
        gitStore.checkGitRepo(workspacePath).then((isGit) => {
          if (!isGit || version !== get()._projectVersion) return;
          gitStore.fetchWorktrees(workspacePath);
          gitStore.fetchStatus(workspacePath);
          gitStore.fetchBranches(workspacePath);
        });

        if (!skipAutoSession) {
          const cached = get().sessionsByProject[tab.path];

          if (cached && cached.length > 0) {
            // 有缓存：立即选中会话，后台刷新列表
            const targetSession = pickDefaultSessionId(
              cached,
              get().lastActiveSessionByProject[tab.path],
            );
            if (!targetSession) return;
            set((s) => ({
              activeSessionId: targetSession,
              projectStartFailed: { ...s.projectStartFailed, [id]: false },
              projectStartError: { ...s.projectStartError, [id]: "" },
              lastActiveSessionByProject: {
                ...s.lastActiveSessionByProject,
                [tab.path]: targetSession,
              },
            }));
            get().setActiveSession(targetSession, true);

            // 后台轻量刷新会话列表（不阻塞 UI）
            get().refreshSessionsInBackground(tab.path);

            // 后台拉取当前项目其他会话状态
            get().fetchProjectSessionStatuses(tab.path);
          } else {
            // 无缓存：走完整加载
            get()
              .loadSessionsForProject(tab.path)
              .then(async (sessions) => {
                if (version !== get()._projectVersion) return;

                if (sessions.length > 0) {
                  const targetSession = pickDefaultSessionId(
                    sessions,
                    get().lastActiveSessionByProject[tab.path],
                  );
                  if (!targetSession) return;
                  set((s) => ({
                    activeSessionId: targetSession,
                    projectStartFailed: { ...s.projectStartFailed, [id]: false },
                    projectStartError: { ...s.projectStartError, [id]: "" },
                    lastActiveSessionByProject: {
                      ...s.lastActiveSessionByProject,
                      [tab.path]: targetSession,
                    },
                  }));
                  get().setActiveSession(targetSession, true);
                  await get().fetchAllSessionStatuses();
                } else {
                  set((s) => ({
                    projectStartFailed: { ...s.projectStartFailed, [id]: false },
                    projectStartError: { ...s.projectStartError, [id]: "" },
                  }));
                  await get().createNewSession();
                }
              });
          }
        }
      },

      loadSessionsForProject: createLoadSessionsForProjectAction({
        get,
        set,
        log,
      }),

      setActiveSession: createSetActiveSessionAction({
        get,
        set,
        log,
        perfLog,
        clearStatusWatchdog,
        isAgentStarted,
        markAgentStarted,
        clearAgentStarted,
      }),

      retryActiveProject: createRetryActiveProjectAction({
        get,
        set,
      }),

      createNewSession: createCreateNewSessionAction({
        get,
        set,
        log,
        insertAfterPinned,
      }),

      updateSessionProjectPath: createUpdateSessionProjectPathAction({
        set,
        log,
      }),

      renameSession: createRenameSessionAction({
        set,
        log,
      }),

      deleteSession: (sessionId) => {
        _agentStartedSessions.delete(sessionId);
        clearStatusWatchdog(sessionId);
        cleanupSession(get(), sessionId);
        cleanupSessionData(sessionId);
        set((s) => {
          const subClean = clearSubscriptionState(s, sessionId);
          const { [sessionId]: _ar, ...restAgentReady } = s.agentReady;
          const { [sessionId]: _sc, ...restContext } = s.sessionContextMap;
          const { [sessionId]: _stats, ...restStats } = s.sessionStatsMap;
          const { [sessionId]: _ss, ...restStatus } = s.sessionStatusMap;
          const { [sessionId]: _ms, ...restModel } = s.modelBySession;
          return {
            ...subClean,
            agentReady: restAgentReady,
            sessionContextMap: restContext,
            sessionStatsMap: restStats,
            sessionStatusMap: restStatus,
            modelBySession: restModel,
          };
        });

        useSessionTodoStore.getState().clearSessionTodos(sessionId);
        useSessionQueueStore.getState().clearSessionQueue(sessionId);

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

        let nextActiveId = activeSessionId;
        if (activeSessionId === sessionId) {
          const remaining = deletedPath ? updated[deletedPath] : [];
          nextActiveId = remaining.length > 0 ? remaining[0].sessionId : null;
        }

        set({
          sessionsByProject: updated,
        });

        if (nextActiveId) {
          get().setActiveSession(nextActiveId, true);
        } else {
          set({ activeSessionId: null });
        }
        if (deletedPath) {
          useChatStore.getState().clearSessionMessages(sessionId);
          useChatStore.getState().clearInputDraft(sessionId);
        }
        useTurnStore.getState().clearSessionUI(sessionId);
        useChatNavStore.getState().clearSessionUI(sessionId);

        if (deletedSessionPath) {
          const subState = useSubagentStore.getState();
          const subs = subState.subsessionsByParent[deletedSessionPath];
          if (subs) {
            const newSubsByParent = { ...subState.subsessionsByParent };
            delete newSubsByParent[deletedSessionPath];
            const newMessages = { ...subState.messagesBySubsession };
            const newStatus = { ...subState.subagentStatusMap };
            const newContext = { ...subState.subagentContextMap };
            for (const sub of subs) {
              delete newMessages[sub.sessionId];
              delete newStatus[sub.sessionId];
              delete newContext[sub.sessionId];
            }
            clearSubagentToolNames(subs.map((s) => s.sessionId));
            useSubagentStore.setState({
              subsessionsByParent: newSubsByParent,
              messagesBySubsession: newMessages,
              subagentStatusMap: newStatus,
              subagentContextMap: newContext,
              activeSubsessionId: subs.some((s) => s.sessionId === subState.activeSubsessionId)
                ? null
                : subState.activeSubsessionId,
            });
          }
        }

        if (deletedSessionPath) {
          // Stop backend process first, then delete session file
          apiClient
            .call("agent.stop", { sessionId })
            .catch((err) => {
              log.warn("agent.stop before delete failed", {
                sessionId,
                err: err instanceof Error ? err.message : String(err),
              });
            })
            .then(() =>
              apiClient.call("session.delete", { sessionId, sessionPath: deletedSessionPath }),
            )
            .catch((err) => {
              log.warn("session.delete failed", {
                err: err instanceof Error ? err.message : String(err),
              });
            });
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
          apiClient.call("session.unpin", { sessionId }).catch((err) => {
            log.warn("session.unpin failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          });
        } else {
          apiClient.call("session.pin", { sessionId }).catch((err) => {
            log.warn("session.pin failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          });
        }
      },

      updateSessionContext: (sessionId, usage) => {
        set((s) => {
          const prev = s.sessionContextMap[sessionId] || { tokens: null, contextWindow: 0 };
          const next = { ...prev, ...usage };
          if (
            usage.contextWindow !== undefined &&
            usage.contextWindow <= 0 &&
            prev.contextWindow > 0
          ) {
            next.contextWindow = prev.contextWindow;
          }
          return {
            sessionContextMap: { ...s.sessionContextMap, [sessionId]: next },
          };
        });
      },

      refreshSessionContext: async (sessionId) => {
        const usage = await apiClient.call("agent.getContextUsage", { sessionId });
        if (usage) {
          get().updateSessionContext(sessionId, usage);
        }
      },

      updateSessionStats: (sessionId, stats) => {
        set((s) => ({
          sessionStatsMap: { ...s.sessionStatsMap, [sessionId]: stats },
        }));
      },

      refreshSessionStats: async (sessionId) => {
        const stats = await apiClient.call("agent.getSessionStats", { sessionId });
        if (stats) {
          get().updateSessionStats(sessionId, stats);
          if (stats.contextUsage) {
            get().updateSessionContext(sessionId, stats.contextUsage);
          }
        }
      },

      updateSessionStatus: (sessionId, status) => {
        const previousStatus = get().sessionStatusMap[sessionId] ?? "idle";
        set((s) => ({
          sessionStatusMap: { ...s.sessionStatusMap, [sessionId]: status },
          ...(status === "streaming" || status === "idle"
            ? clearActiveProjectStartErrorForSession(s, sessionId)
            : {}),
        }));

        if (status === "idle" && previousStatus !== "idle") {
          get().scheduleWorkspaceResourceRefresh(sessionId);
        }

        const existing = _statusWatchdogs.get(sessionId);
        if (existing) {
          clearTimeout(existing);
          _statusWatchdogs.delete(sessionId);
        }

        if (status !== "idle") {
          const timer = setTimeout(() => {
            const current = get().sessionStatusMap[sessionId];
            if (current && current !== "idle") {
              useNotificationStore.getState().push({
                message: `Session status stuck in "${current}" state for ${STATUS_STUCK_TIMEOUT_MS / 60000} minutes`,
                level: "error",
              });
              // ❌ 不再强制切到 idle，只报警告
            }
            _statusWatchdogs.delete(sessionId);
          }, STATUS_STUCK_TIMEOUT_MS);
          _statusWatchdogs.set(sessionId, timer);
        }
      },

      restoreContextFromHistory: (sessionId) => {
        const existing = get().sessionContextMap[sessionId];
        if (existing?.tokens != null && existing.tokens > 0) return;
        apiClient
          .call("agent.getContextUsage", { sessionId })
          .then((r) => {
            if (r && r.tokens != null) {
              get().updateSessionContext(sessionId, r);
            }
          })
          .catch(() => {});
      },

      fetchInitialState: createFetchInitialStateAction({
        get,
        set,
        log,
        perfLog,
      }),

      fetchModelState: async (sessionId, options) => {
        const cached = get().availableModelsBySession[sessionId];
        if (!options?.force && cached) {
          set({ availableModels: cached });
          if (options?.includeFavorites !== false && get().modelFavorites.size === 0) {
            get().fetchModelFavorites();
          }
          return;
        }

        const existingPromise = _modelStatePromises.get(sessionId);
        if (existingPromise) {
          await existingPromise;
        } else {
          const promise = apiClient
            .call("agent.getAvailableModels", { sessionId })
            .then((modelsResult) => {
              if (Array.isArray(modelsResult)) {
                set((s) => ({
                  availableModels: modelsResult,
                  availableModelsBySession: {
                    ...s.availableModelsBySession,
                    [sessionId]: modelsResult,
                  },
                }));
              }
            })
            .catch((err) => {
              log.warn("agent.getAvailableModels failed", {
                sessionId,
                err: err instanceof Error ? err.message : String(err),
              });
            })
            .finally(() => {
              _modelStatePromises.delete(sessionId);
            });
          _modelStatePromises.set(sessionId, promise);
          await promise;
        }
        if (options?.includeFavorites !== false && get().modelFavorites.size === 0) {
          get().fetchModelFavorites();
        }
      },

      setCurrentModel: (provider, modelId) => {
        const sid = get().activeSessionId;
        const match = get().availableModels.find(
          (m) => m.provider === provider && m.id === modelId,
        );
        const model: ModelInfo = {
          provider,
          id: modelId,
          ...(match?.name ? { name: match.name } : {}),
          reasoning: match?.reasoning,
        };
        set({
          currentModel: model,
          modelManuallySet: true,
          ...(sid ? { modelBySession: { ...get().modelBySession, [sid]: model } } : {}),
        });
      },
      setThinkingLevel: (level) => set({ currentThinkingLevel: level }),

      fetchModelFavorites: () => {
        apiClient
          .call("project.getModelFavorites", {})
          .then((res) => {
            set({ modelFavorites: new Set((res as { favorites: string[] }).favorites) });
          })
          .catch(() => {});
      },

      toggleModelFavorite: (modelKey) => {
        apiClient
          .call("project.toggleModelFavorite", { modelKey })
          .then((res) => {
            set({ modelFavorites: new Set((res as { favorites: string[] }).favorites) });
          })
          .catch(() => {});
      },

      scheduleWorkspaceResourceRefresh: (sessionId) => {
        scheduleWorkspaceResourceRefresh(get, sessionId);
      },

      refreshSessionResources: (sessionId) => {
        apiClient
          .call("agent.reload", { sessionId })
          .then(() => {
            get().fetchInitialState(sessionId);
          })
          .catch((err) => {
            log.warn("agent.reload failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });
      },

      cleanupActiveSession: (sessionId) => {
        clearStatusWatchdog(sessionId);
        clearResourceRefreshTimer(sessionId);
        cleanupSession(get(), sessionId);
        cleanupSessionData(sessionId);
        set((s) => clearSubscriptionState(s, sessionId));
        useTierStore.getState().clearSession(sessionId);
      },

      fetchAllSessionStatuses: async () => {
        // Delegate to project-scoped fetch for the active project
        const { activeProjectId, projectTabs } = get();
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;
        await get().fetchProjectSessionStatuses(tab.path);
      },

      fetchProjectSessionStatuses: async (projectPath: string) => {
        const sessions = get().sessionsByProject[projectPath];
        if (!sessions || sessions.length === 0) return;

        const sessionStatusMap = get().sessionStatusMap;
        const { activeSessionId } = get();

        let updated = 0;

        for (const s of sessions) {
          if (!sessionStatusMap[s.sessionId]) {
            if (s.sessionId !== activeSessionId) {
              get().updateSessionStatus(s.sessionId, "idle");
            }
            updated++;
          }
        }

        log.info("fetchProjectSessionStatuses: set idle for non-active sessions", {
          projectPath,
          total: sessions.length,
          updated,
          activeSessionId,
        });
      },

      /**
       * 后台轻量刷新会话列表：调 scanSessions，与缓存做 diff，只更新变化部分。
       * 不阻塞 UI，失败静默忽略。
       */
      refreshSessionsInBackground: (projectPath) => {
        apiClient
          .call("project.scanSessions", { projectPath })
          .then((result) => {
            let sessions = result.sessions as SessionMeta[];

            const seen = new Set<string>();
            const seenPaths = new Set<string>();
            sessions = sessions.filter((s) => {
              if (seen.has(s.sessionId)) return false;
              if (seenPaths.has(s.sessionPath)) return false;
              seen.add(s.sessionId);
              seenPaths.add(s.sessionPath);
              return true;
            });

            const cached = get().sessionsByProject[projectPath] ?? [];
            const cachedIds = new Set(cached.map((s) => s.sessionId));
            const freshIds = new Set(sessions.map((s) => s.sessionId));

            const added = sessions.filter((s) => !cachedIds.has(s.sessionId));
            const removedIds = new Set(
              cached
                .filter((s) => !freshIds.has(s.sessionId) && !s.delegateParentSessionId)
                .map((s) => s.sessionId),
            );

            if (added.length > 0 || removedIds.size > 0) {
              const updatedMap = new Map(cached.map((s) => [s.sessionId, s]));
              for (const fresh of sessions) {
                const existing = updatedMap.get(fresh.sessionId);
                if (existing) {
                  updatedMap.set(fresh.sessionId, {
                    ...existing,
                    messageCount: fresh.messageCount,
                    firstMessage: fresh.firstMessage,
                    updatedAt: fresh.updatedAt,
                  });
                }
              }

              const merged = cached.filter((s) => !removedIds.has(s.sessionId)).concat(added);

              set((s) => ({
                sessionsByProject: { ...s.sessionsByProject, [projectPath]: merged },
              }));

              log.info("refreshSessionsInBackground: updated", {
                projectPath,
                added: added.length,
                removed: removedIds.size,
              });
            }
          })
          .catch(() => {
            // 后台刷新失败不影响用户
          });
      },

      /**
       * 批量拉取多个 session 的运行状态（轻量）。
       * 优先尝试 batchGetSessionsStatus RPC，fallback 到逐个 agent.getState。
       */
      fetchSessionsStatusBatch: async (sessionIds) => {
        if (sessionIds.length === 0) return;

        const { activeSessionId } = get();
        const targetIds = sessionIds.filter((id) => id !== activeSessionId);
        if (targetIds.length === 0) return;

        try {
          const results: Array<{ sessionId: string; status: SessionStatus }> = [];

          const raw = await apiClient.call("agent.batchGetSessionsStatus", {
            sessionIds: targetIds,
          });
          for (const r of raw) {
            results.push({ sessionId: r.sessionId, status: r.status as SessionStatus });
          }

          const updates: Record<string, SessionStatus> = {};
          for (const r of results) {
            updates[r.sessionId] = r.status;
          }

          set((s) => ({
            sessionStatusMap: { ...s.sessionStatusMap, ...updates },
          }));

          log.info("fetchSessionsStatusBatch: updated", {
            count: results.length,
          });
        } catch {
          // 失败不影响用户
        }
      },

      /**
       * 拉取所有项目的所有会话状态（后台异步）
       */
      fetchAllProjectsSessionsStatus: async () => {
        const { sessionsByProject, activeSessionId } = get();
        const allIds: string[] = [];

        for (const sessions of Object.values(sessionsByProject)) {
          for (const s of sessions) {
            if (s.sessionId !== activeSessionId) {
              allIds.push(s.sessionId);
            }
          }
        }

        if (allIds.length === 0) return;
        await get().fetchSessionsStatusBatch(allIds);
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
          get().setActiveProject(activeProjectId, { skipAutoSession: true });

          const sessions = await get().loadSessionsForProject(tab.path);
          const found = sessions?.find((s) => s.sessionId === activeSessionId);
          const targetId = found ? activeSessionId : pickDefaultSessionId(sessions);
          if (!targetId) return false;

          set({ activeSessionId: null });
          get().setActiveSession(targetId);

          // 恢复成功后不需要再延迟 500ms 拉一次 fetchAllProjectsSessionsStatus：
          // loadSessionsForProject → project.scanSessions 已经把该项目的状态带回；
          // 非活跃项目由 TabBar 立刻拉。实时变化走 subscription 推送。

          return true;
        } catch (e) {
          log.warn("Failed to recover session", { error: String(e) });
          return false;
        }
      },
    }),
    {
      name: "pi-agent-session",
      partialize: (state) => ({
        modelFavorites: [...state.modelFavorites],
        lastActiveSessionByProject: state.lastActiveSessionByProject,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SessionState> & { modelFavorites?: string[] };
        return {
          ...current,
          modelFavorites: new Set(p.modelFavorites ?? []),
          lastActiveSessionByProject: p.lastActiveSessionByProject ?? {},
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
          agentReady: current.agentReady,
        };
      },
      onRehydrateStorage: () => () => {},
    },
  ),
);

apiClient.onReconnect(() => {
  void (async () => {
    log.info("[onReconnect] triggered");
    const initialState = useSessionStore.getState();
    const { activeSessionId, activeProjectId } = initialState;

    if (!activeSessionId || !activeProjectId) return;
    const resolved = await resolveReconnectTab(initialState);
    if (!resolved) return;

    const { state, tab } = resolved;
    const sessions = state.sessionsByProject[tab.path];
    const session = sessions?.find((s) => s.sessionId === activeSessionId);
    if (!session) return;

    const storeGet = useSessionStore.getState.bind(useSessionStore);
    const storeSet = (fn: (s: SessionState) => Partial<SessionState>) =>
      useSessionStore.setState(fn(useSessionStore.getState()));

    for (const sid of Object.keys(state.agentSubscriptions)) {
      if (sid !== activeSessionId) {
        clearStatusWatchdog(sid);
        cleanupSession(state, sid);
      }
    }

    if (!state.agentSubscriptions[activeSessionId]) {
      setupSubscriptions(useSessionStore.getState(), storeSet, activeSessionId, session);
    }

    apiClient
      .call("agent.start", {
        sessionId: activeSessionId,
        projectPath: session.projectPath,
        sessionPath: session.sessionPath,
      })
      .then((result) => {
        if (result.status === "already_running" || result.status === "started") {
          useSessionStore.setState((s) => {
            const projectId = s.activeProjectId;
            if (!projectId) return {};
            return {
              projectStartFailed: { ...s.projectStartFailed, [projectId]: false },
              projectStartError: { ...s.projectStartError, [projectId]: "" },
            };
          });
          useSessionStore.setState((s) => ({
            sessionReady: { ...s.sessionReady, [activeSessionId]: true },
            agentReady: { ...s.agentReady, [activeSessionId]: true },
          }));
          requestRulesSnapshot(activeSessionId);
          storeGet().fetchInitialState(activeSessionId);

          if (result.status === "already_running") {
            runReconnectMessageLoad({
              sessionId: activeSessionId,
              sessionPath: session.sessionPath,
              loadSessionMessages: (sid, opts) =>
                useChatStore.getState().loadSessionMessages(sid, opts),
              backgroundRefresh: (sid, sPath) =>
                useChatStore.getState()._backgroundRefreshMessages(sid, sPath),
              getContextUsage: (sid) =>
                apiClient.call("agent.getContextUsage", { sessionId: sid }),
              updateSessionContext: (sid, usage) =>
                useSessionStore.getState().updateSessionContext(sid, usage),
            }).catch((err) => {
              log.warn("[onReconnect] load+refresh failed", {
                sessionId: activeSessionId,
                err: err instanceof Error ? err.message : String(err),
              });
            });
          } else {
            runReconnectMessageLoad({
              sessionId: activeSessionId,
              sessionPath: session.sessionPath,
              loadSessionMessages: (sid, opts) =>
                useChatStore.getState().loadSessionMessages(sid, opts),
              backgroundRefresh: (sid, sPath) =>
                useChatStore.getState()._backgroundRefreshMessages(sid, sPath),
              getContextUsage: (sid) =>
                apiClient.call("agent.getContextUsage", { sessionId: sid }),
              updateSessionContext: (sid, usage) =>
                useSessionStore.getState().updateSessionContext(sid, usage),
            }).catch((err) => {
              log.warn("[onReconnect] loadSessionMessages failed", {
                sessionId: activeSessionId,
                err: err instanceof Error ? err.message : String(err),
              });
            });
          }
        }
      })
      .catch((err) => {
        const errMsg = formatProjectStartError(err, tab);
        useAppStore.getState().addLog(`reconnect agent.start failed: ${errMsg}`);
        useSessionStore.setState((s) => {
          const projectId = s.activeProjectId;
          if (!projectId) return {};
          return {
            projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
            projectStartError: { ...s.projectStartError, [projectId]: errMsg },
          };
        });
        log.warn("[onReconnect] agent.start failed", {
          sessionId: activeSessionId,
          error: getErrorMessage(err),
        });
      });

    storeGet()
      .loadSessionsForProject(tab.path)
      .catch((err) => {
        log.warn("[onReconnect] loadSessionsForProject failed", {
          projectPath: tab.path,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    // 不再延迟 3s 调一次 fetchAllProjectsSessionsStatus：
    // loadSessionsForProject → project.scanSessions 已经带回 session 状态；
    // 实时变化走 subscription。
  })();
});
