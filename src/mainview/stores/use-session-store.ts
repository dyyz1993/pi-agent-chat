import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionMeta, ProjectTab, ContextUsage, SessionStatus } from "../types";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";
import { useTierStore } from "./use-tier-store";
import { useChatStore } from "./use-chat-store";
import { useAppStore } from "./use-app-store";
import { useExplorerStore } from "./use-explorer-store";
import { useGitStore } from "./use-git-store";
import {
  useStatusStore,
  deriveSkillScope,
  derivePluginScope,
  type MCPServerInfo,
} from "./use-status-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { useRetryStore } from "./use-retry-store";
import { useSubagentStore, clearSubagentToolNames } from "./use-subagent-store";
import { useAgentStore } from "./use-agent-store";
import {
  setupSubscriptions,
  cleanupSession,
  cleanupSessionData,
  clearSubscriptionState,
  syncTabsToBackend,
  requestRulesSnapshot,
} from "./session-subscriptions";
import type { TodoItem } from "./session-subscriptions";

export type { TodoItem, TodoPriority } from "./session-subscriptions";

const log = createLogger("session");
const perfLog = createLogger("session-perf");

interface ExtensionEntry {
  path: string;
  toolNames: string[];
  commandNames: string[];
}

interface SkillEntry {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo?: { scope?: string };
}

interface SkillsResponse {
  skills?: SkillEntry[];
  [index: number]: SkillEntry;
}

interface DisabledSkillsResponse {
  disabledSkills?: string[];
}

interface AgentStateResult {
  model?: { provider?: string; id: string; name: string; contextWindow?: number };
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
}

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
  todosBySession: Record<string, TodoItem[]>;
  sessionContextMap: Record<string, ContextUsage>;
  sessionStatusMap: Record<string, SessionStatus>;
  queueBySession: Record<string, { steering: string[]; followUp: string[] }>;
  currentModel: ModelInfo | null;
  modelManuallySet: boolean;
  currentThinkingLevel: string;
  availableModels: Array<{
    provider: string;
    id: string;
    name?: string;
    contextWindow?: number;
    reasoning?: boolean;
  }>;
  modelFavorites: Set<string>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  _projectVersion: number;

  addProjectTab: (tab: ProjectTab) => void;
  removeProjectTab: (id: string) => void;
  reorderProjectTabs: (fromIndex: number, toIndex: number) => void;
  setActiveProject: (id: string, options?: { skipAutoSession?: boolean }) => void;
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
  refreshSessionResources: (sessionId: string) => void;
  setCurrentModel: (provider: string, modelId: string) => void;
  setThinkingLevel: (level: string) => void;
  fetchModelFavorites: () => void;
  toggleModelFavorite: (modelKey: string) => void;
  cleanupActiveSession: (sessionId: string) => void;
  fetchAllSessionStatuses: () => Promise<void>;
}

const _fetchInitPromiseMap = new Map<string, Promise<void>>();

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
      coordinatorSubscriptions: {},
      supervisorSubscriptions: {},
      sessionReady: {},
      todosBySession: {},
      sessionContextMap: {},
      sessionStatusMap: {},
      queueBySession: {},
      currentModel: null,
      modelManuallySet: false,
      currentThinkingLevel: "medium",
      availableModels: [],
      modelFavorites: new Set<string>(),
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
              ? (filtered[filtered.length - 1]?.id ?? null)
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

      setActiveProject: (id, options?) => {
        const prevProjectId = get().activeProjectId;
        const prevSessionId = get().activeSessionId;
        const skipAutoSession = options?.skipAutoSession ?? false;

        if (prevProjectId && prevProjectId !== id && prevSessionId) {
          cleanupSession(get(), prevSessionId);
          cleanupSessionData(prevSessionId);
          set((s) => clearSubscriptionState(s, prevSessionId));
        }

        const version = get()._projectVersion + 1;
        set({ activeProjectId: id, activeSessionId: null, _projectVersion: version });
        const tabs = get().projectTabs;
        syncTabsToBackend(tabs, id);
        const tab = tabs.find((t) => t.id === id);
        if (!tab) return;

        const explorer = useExplorerStore.getState();
        explorer.setCurrentPath(tab.path);
        explorer.listRootDir();

        const gitStore = useGitStore.getState();
        gitStore.checkGitRepo(tab.path).then((isGit) => {
          if (!isGit || version !== get()._projectVersion) return;
          gitStore.fetchWorktrees(tab.path);
          gitStore.fetchStatus(tab.path);
          gitStore.fetchBranches(tab.path);
        });

        if (!skipAutoSession) {
          get()
            .loadSessionsForProject(tab.path)
            .then(async (sessions) => {
              if (version !== get()._projectVersion) return;

              set((s) => ({
                projectStartFailed: { ...s.projectStartFailed, [id]: false },
                projectStartError: { ...s.projectStartError, [id]: "" },
              }));

              if (sessions.length > 0) {
                get().setActiveSession(sessions[0].sessionId);
                // 拉取该项目的所有 session 状态
                await get().fetchAllSessionStatuses();
              } else {
                await get().createNewSession();
              }
            });
        }
      },

      loadSessionsForProject: async (projectPath) => {
        set({ loading: true });
        try {
          const result = await apiClient.call("project.scanSessions", { projectPath });
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

          const existing = get().sessionsByProject[projectPath] || [];
          const existingPaths = new Set(existing.map((s) => s.sessionPath));
          const existingIds = new Set(existing.map((s) => s.sessionId));
          const newFromDisk = sessions.filter((s) => !existingPaths.has(s.sessionPath));

          // Merge: keep in-memory sessions + add new from disk, deduplicate
          const allBlankSessions = [...existing, ...newFromDisk].filter(
            (s) => s.messageCount === 0 && !s.firstMessage,
          );
          let blankToRemove: Set<string> | null = null;
          if (allBlankSessions.length > 1) {
            const toRemove = allBlankSessions.slice(0, -1);
            blankToRemove = new Set(toRemove.map((s) => s.sessionId));

            for (const s of toRemove) {
              apiClient
                .call("session.delete", { sessionId: s.sessionId, sessionPath: s.sessionPath })
                .catch(() => {});
            }
          }

          // Merge disk sessions into existing: update known ones, append new ones
          const merged = existing.map((mem) => {
            const disk = sessions.find((s) => s.sessionPath === mem.sessionPath);
            return disk ?? mem;
          });
          for (const s of newFromDisk) {
            if (
              !existingIds.has(s.sessionId) &&
              !merged.some((m) => m.sessionPath === s.sessionPath)
            ) {
              merged.push(s);
            }
          }

          // Remove excess blank sessions from merged result
          const finalSessions = blankToRemove
            ? merged.filter((s) => !blankToRemove.has(s.sessionId))
            : merged;

          set((s) => ({
            sessionsByProject: { ...s.sessionsByProject, [projectPath]: finalSessions },
            loading: false,
          }));
          return finalSessions;
        } catch {
          set({ loading: false });
          return [];
        }
      },

      setActiveSession: (id, force) => {
        const tSwitchStart = performance.now();
        const prevId = get().activeSessionId;
        if (!force && prevId === id) return;

        perfLog.info("[switch] === SESSION SWITCH START ===", {
          from: prevId ?? "(none)",
          to: id,
          force: !!force,
        });

        if (prevId && prevId !== id) {
          const t0 = performance.now();
          cleanupSession(get(), prevId);
          cleanupSessionData(prevId);
          set((s) => clearSubscriptionState(s, prevId));
          perfLog.info("[switch] step-1 cleanup old session", {
            prevId,
            ms: Math.round(performance.now() - t0),
          });
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

        ensureSession()
          .then((session) => {
            if (get().activeSessionId !== id) return;
            if (!session) {
              set((s) => {
                const projectId = s.activeProjectId;
                if (!projectId) return {};
                return {
                  projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                  projectStartError: {
                    ...s.projectStartError,
                    [projectId]: "Session metadata not found",
                  },
                };
              });
              return;
            }

            const tSubs = performance.now();
            setupSubscriptions(get(), set, id, session);
            perfLog.info("[switch] step-2 setupSubscriptions dispatched", {
              sessionId: id,
              ms: Math.round(performance.now() - tSubs),
            });

            perfLog.info("[switch] step-3 agent.start RPC begin", { sessionId: id });
            const tAgentStart = performance.now();

            const startPromise = apiClient.call("agent.start", {
              sessionId: id,
              projectPath: session.projectPath,
              sessionPath: session.sessionPath,
            });

            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("agent.start timed out (30s)")), 30_000),
            );

            Promise.race([startPromise, timeoutPromise])
              .then((result) => {
                perfLog.info("[switch] step-3 agent.start RPC done", {
                  sessionId: id,
                  status: result.status,
                  ms: Math.round(performance.now() - tAgentStart),
                });

                if (
                  result.status === "already_running" ||
                  result.status === "started" ||
                  result.status === "switched"
                ) {
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

                  // Request rules snapshot after session is confirmed started
                  requestRulesSnapshot(id);

                  perfLog.info("[switch] step-4 fetchInitialState begin", { sessionId: id });
                  get().fetchInitialState(id);

                  const tParallel = performance.now();

                  const replayPromise =
                    result.status === "already_running"
                      ? apiClient
                          .call("agent.replayHoldEvents", { sessionId: id })
                          .then((r) => {
                            perfLog.info("[switch] step-5 replayHoldEvents done", {
                              sessionId: id,
                              replayed: r.replayed,
                              ms: Math.round(performance.now() - tParallel),
                            });
                          })
                          .catch((err) => {
                            log.warn("replayHoldEvents failed", {
                              sessionId: id,
                              err: err instanceof Error ? err.message : String(err),
                            });
                          })
                      : Promise.resolve();

                  perfLog.info("[switch] step-6 loadSessionMessages begin", { sessionId: id });
                  const tLoad = performance.now();
                  const loadMessagesPromise = useChatStore
                    .getState()
                    .loadSessionMessages(id, { sessionPath: session.sessionPath })
                    .then(() => {
                      perfLog.info("[switch] step-6 loadSessionMessages done", {
                        sessionId: id,
                        count: useChatStore.getState().messagesBySession[id]?.length,
                        ms: Math.round(performance.now() - tLoad),
                      });
                    })
                    .catch((e) => {
                      log.error("loadSessionMessages FAILED", {
                        error: e instanceof Error ? e.message : String(e),
                      });
                    });

                  Promise.all([replayPromise, loadMessagesPromise]).then(() => {
                    perfLog.info("[switch] === SESSION SWITCH COMPLETE ===", {
                      sessionId: id,
                      totalMs: Math.round(performance.now() - tSwitchStart),
                    });
                  });
                } else {
                  const projectId = get().activeProjectId;
                  if (projectId) {
                    set((s) => ({
                      projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                      projectStartError: {
                        ...s.projectStartError,
                        [projectId]: `Unexpected status: ${result.status}`,
                      },
                    }));
                  }
                }
              })
              .catch((err) => {
                const errMsg = err instanceof Error ? err.message : String(err);
                useAppStore.getState().addLog(`agent.start failed: ${errMsg}`);
                perfLog.error("[switch] agent.start FAILED", {
                  sessionId: id,
                  error: errMsg,
                  totalMs: Math.round(performance.now() - tSwitchStart),
                });
                set((s) => {
                  const projectId = s.activeProjectId;
                  if (!projectId) return {};
                  return {
                    projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                    projectStartError: { ...s.projectStartError, [projectId]: errMsg },
                  };
                });
              });
          })
          .catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            useAppStore.getState().addLog(`ensureSession failed: ${errMsg}`);
            perfLog.error("[switch] ensureSession FAILED", {
              sessionId: id,
              error: errMsg,
              totalMs: Math.round(performance.now() - tSwitchStart),
            });
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
        const {
          activeProjectId,
          activeSessionId,
          projectTabs,
          agentSubscriptions,
          subagentSubscriptions,
        } = get();
        if (!activeProjectId) return;
        const tab = projectTabs.find((t) => t.id === activeProjectId);
        if (!tab) return;

        const newAgentSubs = { ...agentSubscriptions };
        const newSubagentSubs = { ...subagentSubscriptions };
        if (activeSessionId) {
          delete newAgentSubs[activeSessionId];
          delete newSubagentSubs[activeSessionId];
        }

        // 清理重试状态，避免手动重试时通知卡住
        if (activeSessionId) {
          useRetryStore.getState().endRetry(activeSessionId);
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

        const existing = get().sessionsByProject[tab.path];
        const blankSession = existing?.find((s) => s.messageCount === 0 && !s.firstMessage);
        if (blankSession) {
          log.info("Reusing existing blank session", { sessionId: blankSession.sessionId });
          get().setActiveSession(blankSession.sessionId);
          return;
        }

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
            delegateParentSessionId: null,
            messageCount: 0,
            firstMessage: "",
            createdAt: now,
            updatedAt: now,
            status: "idle",
          };

          set((s) => {
            const existing = s.sessionsByProject[tab.path] || [];
            if (existing.some((sess) => sess.sessionId === result.sessionId)) return {};
            return {
              sessionsByProject: {
                ...s.sessionsByProject,
                [tab.path]: insertAfterPinned(existing, newSession),
              },
            };
          });

          get().setActiveSession(result.sessionId);

          const currentTier = useTierStore.getState().currentTier;
          if (currentTier) {
            useTierStore.getState().switchToTier(currentTier, result.sessionId);
          }
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
          apiClient.call("session.updateCwd", { sessionPath, newCwd: projectPath }).catch((err) => {
            log.warn("session.updateCwd failed", {
              err: err instanceof Error ? err.message : String(err),
            });
          });
        }
        apiClient.call("agent.setCwd", { sessionId, cwd: projectPath }).catch((err) => {
          log.warn("agent.setCwd failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        });
      },

      renameSession: (sessionId, newName) => {
        const trimmed = newName.trim();
        if (!trimmed) return;

        let sessionPath = "";
        set((s) => {
          const updated: Record<string, SessionMeta[]> = {};
          for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
            updated[path] = sessions.map((sess) => {
              if (sess.sessionId === sessionId) {
                sessionPath = sess.sessionPath;
                return { ...sess, name: trimmed };
              }
              return sess;
            });
          }
          return { sessionsByProject: updated };
        });
        if (sessionPath) {
          apiClient
            .call("session.rename", { sessionId, sessionPath, newName: trimmed })
            .catch((err) => {
              log.warn("session.rename failed", {
                err: err instanceof Error ? err.message : String(err),
              });
            });
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

        let nextActiveId = activeSessionId;
        if (activeSessionId === sessionId) {
          const remaining = deletedPath ? updated[deletedPath] : [];
          nextActiveId = remaining.length > 0 ? remaining[0].sessionId : null;
        }

        set({
          sessionsByProject: updated,
          activeSessionId: nextActiveId,
        });
        if (deletedPath) {
          useChatStore.getState().clearSessionMessages(sessionId);
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
          apiClient
            .call("session.delete", { sessionId, sessionPath: deletedSessionPath })
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
        apiClient
          .call("agent.getContextUsage", { sessionId })
          .then((r) => {
            if (r && r.tokens != null) {
              get().updateSessionContext(sessionId, {
                tokens: r.tokens,
                ...(r.contextWindow > 0 ? { contextWindow: r.contextWindow } : {}),
              });
            }
          })
          .catch(() => {});
      },

      fetchInitialState: (sessionId) => {
        const existing = _fetchInitPromiseMap.get(sessionId);
        if (existing) return existing;

        const promise = (async () => {
          try {
            const t0 = performance.now();
            perfLog.info("[fetchInit] begin (all-parallel)", { sessionId });

            const statePromise = apiClient.call("agent.getState", { sessionId });
            const modelsPromise = apiClient.call("agent.getAvailableModels", { sessionId });
            const contextPromise = apiClient.call("agent.getContextUsage", { sessionId });
            const extensionsPromise = apiClient.call("agent.getExtensions", { sessionId });
            const skillsPromise = apiClient.call("agent.getSkills", { sessionId });
            const disabledSkillsPromise = apiClient.call("agent.getDisabledSkills", {});
            const mcpPromise = apiClient.call("agent.getMcpServers", { sessionId });
            const queuePromise = apiClient.call("agent.getQueue", { sessionId });
            const agentChangePromise = apiClient.call("agent.getLatestAgentChange", { sessionId });
            const agentsPromise = apiClient.call("agent.getAgents", { sessionId });
            const currentAgentPromise = apiClient.call("agent.getCurrentAgent", { sessionId });

            statePromise
              .then((rawResult) => {
                perfLog.info("[fetchInit] getState done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                const result = rawResult as AgentStateResult;
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
                  // Don't overwrite if user manually switched model via picker
                  const manuallySet = get().modelManuallySet;
                  set({
                    currentModel: {
                      provider: result.model.provider ?? "",
                      id: result.model.id,
                      name: result.model.name,
                    },
                    modelManuallySet: false,
                  });
                  if (manuallySet) {
                    log.info("skipped model overwrite (user manually switched)", {
                      sessionId,
                      manualModel: `${result.model.provider}/${result.model.id}`,
                    });
                  }
                }

                useTierStore
                  .getState()
                  .syncTierFromModel(result.model?.provider ?? "", result.model?.id ?? "");
              })
              .catch((err) => {
                log.warn("agent.getState failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            modelsPromise
              .then((modelsResult) => {
                if (Array.isArray(modelsResult)) {
                  set({ availableModels: modelsResult });
                }
              })
              .catch((err) => {
                log.warn("agent.getAvailableModels failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            const handleContextRetry = (_attempt: number): void => {
              apiClient
                .call("agent.getContextUsage", { sessionId })
                .then((r) => {
                  if (r && (r.contextWindow > 0 || r.tokens != null)) {
                    const update: Partial<ContextUsage> = {};
                    if (r.contextWindow > 0) update.contextWindow = r.contextWindow;
                    if (r.tokens != null) update.tokens = r.tokens;
                    get().updateSessionContext(sessionId, update);
                  }
                })
                .catch(() => {});
            };

            contextPromise
              .then((r) => {
                perfLog.info("[fetchInit] getContextUsage", {
                  sessionId,
                  attempt: 0,
                  ms: Math.round(performance.now() - t0),
                });
                if (!r) {
                  setTimeout(() => handleContextRetry(1), 1500);
                  return;
                }
                const update: Partial<ContextUsage> = {};
                if (r.contextWindow > 0) update.contextWindow = r.contextWindow;
                if (r.tokens != null) {
                  update.tokens = r.tokens;
                } else {
                  setTimeout(() => handleContextRetry(1), 1500);
                  return;
                }
                if (update.contextWindow || update.tokens != null) {
                  get().updateSessionContext(sessionId, update);
                }
              })
              .catch((err) => {
                log.warn("agent.getContextUsage failed in fetchInitialState", {
                  sessionId,
                  attempt: 0,
                  err: err instanceof Error ? err.message : String(err),
                });
                setTimeout(() => handleContextRetry(1), 1500);
              });

            extensionsPromise
              .then((res) => {
                perfLog.info("[fetchInit] getExtensions done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                const rawExts = Array.isArray(res)
                  ? res
                  : ((res as { extensions?: ExtensionEntry[] })?.extensions ?? []);
                const exts = rawExts as ExtensionEntry[];
                if (exts.length === 0) return;
                const plugins = exts.map((e: ExtensionEntry) => {
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
              })
              .catch((err) => {
                log.warn("agent.getExtensions failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            Promise.all([skillsPromise, disabledSkillsPromise])
              .then(([skillsRes, disabledRes]) => {
                perfLog.info("[fetchInit] getSkills+getDisabledSkills done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                const skillsArr = (
                  Array.isArray(skillsRes)
                    ? skillsRes
                    : ((skillsRes as SkillsResponse)?.skills ?? [])
                ) as SkillEntry[];
                if (skillsArr.length === 0) {
                  useAppStore
                    .getState()
                    .addLog(`[skills] non-array response, type=${typeof skillsRes}`);
                  return;
                }
                const disabled = disabledRes as DisabledSkillsResponse;
                const disabledSet = new Set(disabled?.disabledSkills ?? []);
                useAppStore
                  .getState()
                  .addLog(
                    `[skills] loaded ${skillsArr.length} items, ${disabledSet.size} disabled`,
                  );
                useStatusStore.getState().setSkills(
                  skillsArr.map((s: SkillEntry) => {
                    const fp: string = s.filePath;
                    const scope: "global" | "project" =
                      s.sourceInfo?.scope === "user" ? "global" : deriveSkillScope(fp);
                    return {
                      name: s.name,
                      description: s.description,
                      filePath: fp,
                      baseDir: s.baseDir,
                      disableModelInvocation: s.disableModelInvocation,
                      enabled: !disabledSet.has(s.name),
                      scope,
                    };
                  }),
                );
              })
              .catch((err) => {
                useAppStore
                  .getState()
                  .addLog(
                    `[skills] call failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
              });

            agentsPromise
              .then((agentsResult: unknown) => {
                perfLog.info("[fetchInit] getAgents done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                const raw = agentsResult as {
                  agents?: Array<{
                    name: string;
                    description?: string;
                    tier?: string;
                    tools?: string[];
                    permissionMode?: string;
                    source?: string;
                    filePath?: string;
                  }>;
                };
                const agentList = (raw.agents ?? []).map((a) => ({
                  name: a.name,
                  description: a.description,
                  tier: a.tier,
                  tools: a.tools,
                  permissionMode: a.permissionMode,
                  source: (a.source ?? "builtin") as "builtin" | "user" | "project",
                  filePath: a.filePath ?? "",
                }));
                useAgentStore.getState().setAgents(agentList);
              })
              .catch((err: unknown) => {
                log.warn("agent.getAgents failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            currentAgentPromise
              .then((currentResult: unknown) => {
                perfLog.info("[fetchInit] getCurrentAgent done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                const agentResult = currentResult as { agentName: string | null };
                const agentName = agentResult.agentName ?? "build";
                useAgentStore.getState().setCurrentAgent(sessionId, agentName);
              })
              .catch((err: unknown) => {
                log.warn("agent.getCurrentAgent failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            // Agent change restoration runs AFTER agents + currentAgent are set
            // so it can override the current agent with the persisted one
            agentChangePromise
              .then((result: unknown) => {
                perfLog.info("[fetchInit] getLatestAgentChange done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                if (
                  result &&
                  typeof result === "object" &&
                  "agentName" in result &&
                  typeof result.agentName === "string"
                ) {
                  const agentName = result.agentName;
                  log.info("[fetchInit] restoring agent from latest change", {
                    sessionId,
                    agentName,
                    timestamp:
                      "timestamp" in result && typeof result.timestamp === "string"
                        ? result.timestamp
                        : undefined,
                  });
                  const { switchAgent } = useAgentStore.getState();
                  void switchAgent(agentName, sessionId).catch((err: unknown) => {
                    log.warn("[fetchInit] failed to restore agent", {
                      sessionId,
                      agentName,
                      err: err instanceof Error ? err.message : String(err),
                    });
                  });
                } else {
                  // No persisted agent change — load detail for the current agent
                  useAgentStore.getState().fetchAgentDetail(sessionId);
                  useAgentStore.getState().fetchAllTools(sessionId);
                }
              })
              .catch((err: unknown) => {
                log.warn("agent.getLatestAgentChange failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            mcpPromise
              .then((res) => {
                perfLog.info("[fetchInit] getMcpServers done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                const rawServers = res.servers ?? [];
                const servers: MCPServerInfo[] = rawServers.map((s) => ({
                  name: s.name,
                  status: s.status,
                  error: s.error,
                  toolCount: s.tools.length,
                  tools: s.tools.map((t) => ({
                    name: t.originalName,
                    description: t.description,
                  })),
                  scope: (s.scope as "global" | "project") ?? "global",
                  disabled: s.disabled,
                }));
                log.info("[MCP] getMcpServers", {
                  sessionId,
                  count: servers.length,
                  names: servers.map((s) => s.name),
                });
                useStatusStore.getState().setMcpServers(servers);
              })
              .catch((err) => {
                log.warn("agent.getMcpServers failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });

            queuePromise
              .then((result) => {
                perfLog.info("[fetchInit] getQueue done", {
                  sessionId,
                  ms: Math.round(performance.now() - t0),
                });
                perfLog.info("[fetchInit] ALL sub-calls dispatched", {
                  sessionId,
                  totalMs: Math.round(performance.now() - t0),
                });
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
              })
              .catch((err) => {
                log.warn("agent.getQueue failed", {
                  sessionId,
                  err: err instanceof Error ? err.message : String(err),
                });
              });
          } finally {
            _fetchInitPromiseMap.delete(sessionId);
          }
        })();

        _fetchInitPromiseMap.set(sessionId, promise);
        return promise;
      },

      fetchModelState: (sessionId) => {
        apiClient
          .call("agent.getAvailableModels", { sessionId })
          .then((modelsResult) => {
            if (Array.isArray(modelsResult)) {
              set({ availableModels: modelsResult });
            }
          })
          .catch((err) => {
            log.warn("agent.getAvailableModels failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });
        if (get().modelFavorites.size === 0) {
          get().fetchModelFavorites();
        }
      },

      setCurrentModel: (provider, modelId) =>
        set({ currentModel: { provider, id: modelId }, modelManuallySet: true }),
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
        cleanupSession(get(), sessionId);
        cleanupSessionData(sessionId);
        set((s) => clearSubscriptionState(s, sessionId));
      },

      fetchAllSessionStatuses: async () => {
        const sessionsByProject = get().sessionsByProject;
        const sessionStatusMap = get().sessionStatusMap;

        const allSessions: Array<{ sessionId: string; projectPath: string }> = [];
        for (const [projectPath, sessions] of Object.entries(sessionsByProject)) {
          for (const session of sessions) {
            if (!sessionStatusMap[session.sessionId]) {
              allSessions.push({ sessionId: session.sessionId, projectPath });
            }
          }
        }

        if (allSessions.length === 0) {
          log.info("fetchAllSessionStatuses: all sessions already have status");
          return;
        }

        log.info("fetchAllSessionStatuses: fetching statuses", {
          count: allSessions.length,
        });

        const promises = allSessions.map(({ sessionId }) =>
          apiClient.call("agent.getState", { sessionId }).catch((err) => {
            log.warn("agent.getState failed for session", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
            return null;
          }),
        );

        const results = await Promise.allSettled(promises);

        let successCount = 0;
        let failCount = 0;

        results.forEach((result, index) => {
          const sessionId = allSessions[index].sessionId;
          if (result.status === "fulfilled" && result.value) {
            const state = result.value as AgentStateResult;
            let status: SessionStatus = "idle";
            if (state.isStreaming === true) {
              status = "streaming";
            } else if (state.isCompacting === true) {
              status = "compacting";
            }
            get().updateSessionStatus(sessionId, status);
            successCount++;
          } else {
            failCount++;
          }
        });

        log.info("fetchAllSessionStatuses: completed", {
          success: successCount,
          failed: failCount,
        });
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
          const targetId = found
            ? activeSessionId
            : sessions.length > 0
              ? sessions[0].sessionId
              : null;
          if (!targetId) return false;

          set({ activeSessionId: null });
          get().setActiveSession(targetId);

          // 恢复成功后，拉取所有 session 的状态
          await get().fetchAllSessionStatuses();

          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "pi-agent-session",
      partialize: (state) => ({
        modelFavorites: [...state.modelFavorites],
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SessionState> & { modelFavorites?: string[] };
        return {
          ...current,
          ...(persisted as Partial<SessionState>),
          modelFavorites: new Set(p.modelFavorites ?? []),
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
        };
      },
      onRehydrateStorage: () => () => {},
    },
  ),
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

  apiClient
    .call("agent.start", {
      sessionId: activeSessionId,
      projectPath: session.projectPath,
      sessionPath: session.sessionPath,
    })
    .then((result) => {
      if (
        result.status === "already_running" ||
        result.status === "started" ||
        result.status === "switched"
      ) {
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
        }));
        // Request rules snapshot after session is confirmed started
        requestRulesSnapshot(activeSessionId);
        storeGet().fetchInitialState(activeSessionId);
        if (result.status === "already_running") {
          apiClient.call("agent.replayHoldEvents", { sessionId: activeSessionId }).catch((err) => {
            log.warn("agent.replayHoldEvents failed", {
              sessionId: activeSessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }
    })
    .catch((err) => {
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
