import type { StoreApi } from "zustand";
import { apiClient } from "../lib/api-client";
import { createStartupTrace } from "../lib/startup-monitor";
import type { ModelInfo } from "./use-session-store";
import { useSessionStore } from "./use-session-store";
import type { ProjectTab, SessionMeta } from "../types";
import { useAppStore } from "./use-app-store";
import { useChatStore } from "./use-chat-store";
import { useGitStore } from "./use-git-store";
import { useStatusStore } from "./use-status-store";
import { formatProjectStartError, getErrorMessage } from "./session-start-error";
import {
  requestRulesSnapshot,
  setupSubscriptions,
  cleanupSessionLight,
  type SubscriptionMaps,
} from "./session-subscriptions";

interface ActiveSessionState extends SubscriptionMaps {
  activeProjectId: string | null;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  sessionsByProject: Record<string, SessionMeta[]>;
  sessionReady: Record<string, boolean>;
  agentReady: Record<string, boolean>;
  lastActiveSessionByProject: Record<string, string>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  currentModel: ModelInfo | null;
  modelBySession: Record<string, ModelInfo>;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  fetchInitialState: (sessionId: string) => void;
}

type SetState = StoreApi<ActiveSessionState>["setState"];
type GetState = StoreApi<ActiveSessionState>["getState"];

interface ActiveSessionLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}

export function createSetActiveSessionAction({
  get,
  set,
  log,
  perfLog,
  clearStatusWatchdog,
  isAgentStarted,
  markAgentStarted,
  clearAgentStarted,
}: {
  get: GetState;
  set: SetState;
  log: ActiveSessionLogger;
  perfLog: ActiveSessionLogger;
  clearStatusWatchdog: (sessionId: string) => void;
  isAgentStarted: (sessionId: string) => boolean;
  markAgentStarted: (sessionId: string) => void;
  clearAgentStarted: (sessionId: string) => void;
}): ActiveSessionState["activeSessionId"] extends string | null
  ? (
      id: string | null,
      force?: boolean,
      options?: { skipCleanup?: boolean; forceNewProcess?: boolean },
    ) => void
  : never {
  let startGeneration = 0;

  return (id, force, options) => {
    const tSwitchStart = performance.now();
    const prevId = get().activeSessionId;
    if (!force && prevId === id) return;
    const generation = ++startGeneration;
    const isLatestStart = () => get().activeSessionId === id && generation === startGeneration;

    const trace = id ? createStartupTrace("switch-session", { sessionId: id }) : null;
    trace?.mark("begin");

    const skipCleanup = options?.skipCleanup ?? false;

    perfLog.info("[switch] === SESSION SWITCH START ===", {
      from: prevId ?? "(none)",
      to: id,
      force: !!force,
      skipCleanup,
    });

    if (prevId && prevId !== id && !skipCleanup) {
      const t0 = performance.now();
      clearStatusWatchdog(prevId);
      useChatStore.getState().saveInputDraft(prevId);
      cleanupSessionLight(prevId);
      useGitStore.getState().clearDiff();
      perfLog.info("[switch] step-1 light cleanup old session (keep-alive)", {
        prevId,
        ms: Math.round(performance.now() - t0),
      });
      trace?.mark("cleanup-done", { prevId });
    } else if (skipCleanup && prevId && prevId !== id) {
      useChatStore.getState().saveInputDraft(prevId);
      perfLog.info("[switch] step-1 SKIPPED cleanup (fork scenario)", {
        prevId,
      });
    }

    const { projectTabs: curTabs, activeProjectId: curProjectId } = get();
    const curTab = curTabs.find((t) => t.id === curProjectId);

    const hasCachedMessages =
      id &&
      (useChatStore.getState().messagesBySession[id] || []).some(
        (m: { role: string; tokenUsage?: unknown }) =>
          m.role === "user" || (m.role === "assistant" && m.tokenUsage),
      );

    set({
      activeSessionId: id,
      sessionReady: id
        ? {
            ...get().sessionReady,
            [id]: hasCachedMessages ? true : (get().sessionReady[id] ?? false),
          }
        : get().sessionReady,
      // Restore cached model immediately to avoid showing stale model from previous session
      ...(id ? { currentModel: get().modelBySession[id] ?? null } : {}),
      ...(id && curTab
        ? {
            lastActiveSessionByProject: {
              ...get().lastActiveSessionByProject,
              [curTab.path]: id,
            },
          }
        : {}),
    });

    if (!id) return;

    useChatStore.getState().restoreInputDraft(id);

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
        trace?.mark("setup-subs-done");

        const isAgentKnownRunning = isAgentStarted(id);

        if (isAgentKnownRunning) {
          perfLog.info("[switch] HOT (cached): agent.start SKIPPED", { sessionId: id });
          trace?.mark("hot-path-skip-agent-start");

          set((s) => {
            const projectId = s.activeProjectId;
            if (!projectId) return {};
            return {
              sessionReady: { ...s.sessionReady, [id]: true },
              agentReady: { ...s.agentReady, [id]: true },
              projectStartFailed: { ...s.projectStartFailed, [projectId]: false },
              projectStartError: { ...s.projectStartError, [projectId]: "" },
            };
          });

          requestRulesSnapshot(id);

          const cachedMsgs = useChatStore.getState().messagesBySession[id] || [];
          const hasCachedMsgs = cachedMsgs.some(
            (m: { role: string; tokenUsage?: unknown }) =>
              m.role === "user" || (m.role === "assistant" && m.tokenUsage),
          );
          if (hasCachedMsgs) {
            useChatStore.getState()._backgroundRefreshMessages(id, session.sessionPath);
          } else {
            useChatStore.getState().loadSessionMessages(id, {
              force: true,
              sessionPath: session.sessionPath,
            });
          }

          perfLog.info("[switch] === HOT SWITCH COMPLETE (cached) ===", {
            sessionId: id,
            totalMs: Math.round(performance.now() - tSwitchStart),
          });
          return;
        }

        perfLog.info("[switch] agent.start begin", { sessionId: id });
        const tAgentStart = performance.now();

        // Start loading messages immediately — getFullMessages reads JSONL directly
        // and does NOT need the CLI process to be running.
        const preLoadPromise = useChatStore
          .getState()
          .loadSessionMessages(id, {
            force: true,
            sessionPath: session.sessionPath,
          })
          .then(() => {
            if (!isLatestStart()) return;
            perfLog.info("[switch] pre-loadSessionMessages done (parallel with agent.start)", {
              sessionId: id,
              count: useChatStore.getState().messagesBySession[id]?.length,
              ms: Math.round(performance.now() - tAgentStart),
            });
            // Messages loaded from JSONL — session is ready for display.
            // Input send button stays disabled until agentReady (agent.start completes).
            set((s) => ({
              sessionReady: { ...s.sessionReady, [id]: true },
            }));
          })
          .catch(() => {});

        const startPromise = apiClient.call("agent.start", {
          sessionId: id,
          projectPath: session.projectPath,
          sessionPath: session.sessionPath,
          forceNewProcess: options?.forceNewProcess,
        });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("agent.start timed out (30s)")), 30_000),
        );

        Promise.race([startPromise, timeoutPromise])
          .then(async (result) => {
            if (!isLatestStart()) return;
            const isHot = result.status === "already_running";

            perfLog.info("[switch] agent.start done", {
              sessionId: id,
              status: result.status,
              isHot,
              ms: Math.round(performance.now() - tAgentStart),
            });
            trace?.mark("agent-start-done", {
              status: result.status,
              isHot,
              ms: Math.round(performance.now() - tAgentStart),
            });

            if (result.status === "already_running" || result.status === "started") {
              set((s) => {
                const projectId = s.activeProjectId;
                if (!projectId) return {};
                return {
                  sessionReady: { ...s.sessionReady, [id]: true },
                  agentReady: { ...s.agentReady, [id]: true },
                  projectStartFailed: { ...s.projectStartFailed, [projectId]: false },
                  projectStartError: { ...s.projectStartError, [projectId]: "" },
                };
              });
              markAgentStarted(id);

              const rememberedPermissionProfile = useStatusStore
                .getState()
                .getRememberedPermissionProfile(id);
              if (rememberedPermissionProfile) {
                try {
                  await apiClient.call("agent.setPermissionMode", {
                    sessionId: id,
                    mode: rememberedPermissionProfile,
                  });
                  useStatusStore
                    .getState()
                    .applyPermissionProfileSnapshot(rememberedPermissionProfile, id);
                } catch (err) {
                  log.warn("restore permission profile failed", {
                    sessionId: id,
                    profile: rememberedPermissionProfile,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }

              requestRulesSnapshot(id);
              get().fetchInitialState(id);
              trace?.mark("fetch-initial-state-started");

              if (isHot) {
                const cachedMsgs = useChatStore.getState().messagesBySession[id] || [];
                const hasCached = cachedMsgs.some(
                  (m: { role: string; tokenUsage?: unknown }) =>
                    m.role === "user" || (m.role === "assistant" && m.tokenUsage),
                );
                const loadPromise: Promise<void> = hasCached
                  ? useChatStore.getState()._backgroundRefreshMessages(id, session.sessionPath)
                  : useChatStore.getState().loadSessionMessages(id, {
                      force: true,
                      sessionPath: session.sessionPath,
                    });

                loadPromise
                  .catch(() => {})
                  .then(() => {
                    // 不重复调用 _backgroundRefreshMessages — loadPromise 已包含它
                    return apiClient
                      .call("agent.getContextUsage", { sessionId: id })
                      .then((r) => {
                        if (r && r.tokens != null) {
                          useSessionStore.getState().updateSessionContext(id, r);
                        }
                      })
                      .catch(() => {});
                  })
                  .then(() => {
                    perfLog.info("[switch] === HOT SWITCH COMPLETE ===", {
                      sessionId: id,
                      totalMs: Math.round(performance.now() - tSwitchStart),
                    });
                  })
                  .catch((err: unknown) => {
                    log.warn("load+refresh failed in hot switch", {
                      sessionId: id,
                      err: err instanceof Error ? err.message : String(err),
                    });
                  });
              } else {
                // COLD path: messages were pre-loaded in parallel with agent.start.
                perfLog.info("[switch] COLD: waiting for pre-loaded messages", {
                  sessionId: id,
                });
                trace?.mark("cold-preload-await");
                const tLoad = performance.now();
                preLoadPromise
                  .then(() => {
                    perfLog.info("[switch] COLD: pre-load confirmed", {
                      sessionId: id,
                      count: useChatStore.getState().messagesBySession[id]?.length,
                      ms: Math.round(performance.now() - tLoad),
                    });
                    trace?.mark("cold-preload-msg-done", {
                      ms: Math.round(performance.now() - tLoad),
                    });
                    return useChatStore
                      .getState()
                      ._backgroundRefreshMessages(id, session.sessionPath);
                  })
                  .then(() => {
                    return apiClient
                      .call("agent.getContextUsage", { sessionId: id })
                      .then((r) => {
                        if (r && r.tokens != null) {
                          useSessionStore.getState().updateSessionContext(id, r);
                        }
                      })
                      .catch(() => {});
                  })
                  .then(() => {
                    perfLog.info("[switch] === COLD SWITCH COMPLETE ===", {
                      sessionId: id,
                      totalMs: Math.round(performance.now() - tSwitchStart),
                    });
                  })
                  .catch((e) => {
                    log.error("COLD switch load+refresh failed", {
                      error: e instanceof Error ? e.message : String(e),
                    });
                  });
              }
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
            if (!isLatestStart()) return;
            clearAgentStarted(id);
            const currentTab = get().projectTabs.find((t) => t.id === get().activeProjectId);
            const errMsg = formatProjectStartError(err, currentTab);
            log.error("agent.start failed", {
              sessionId: id,
              err: getErrorMessage(err),
            });
            set((s) => {
              const projectId = s.activeProjectId;
              if (!projectId) return {};
              return {
                projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                projectStartError: {
                  ...s.projectStartError,
                  [projectId]: errMsg,
                },
                sessionReady: { ...s.sessionReady, [id]: false },
                agentReady: { ...s.agentReady, [id]: false },
              };
            });
          });
      })
      .catch((err) => {
        const currentTab = get().projectTabs.find((t) => t.id === get().activeProjectId);
        const errMsg = formatProjectStartError(err, currentTab);
        useAppStore.getState().addLog(`ensureSession failed: ${errMsg}`);
        perfLog.error("[switch] ensureSession FAILED", {
          sessionId: id,
          error: getErrorMessage(err),
          totalMs: Math.round(performance.now() - tSwitchStart),
        });
        set((s) => {
          const projectId = s.activeProjectId;
          if (!projectId) return {};
          return {
            sessionReady: { ...s.sessionReady, [id]: false },
            projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
            projectStartError: { ...s.projectStartError, [projectId]: errMsg },
          };
        });
      });
  };
}
