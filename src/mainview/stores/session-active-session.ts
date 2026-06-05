import type { StoreApi } from "zustand";
import { apiClient } from "../lib/api-client";
import type { ProjectTab, SessionMeta } from "../types";
import { useAppStore } from "./use-app-store";
import { useChatStore } from "./use-chat-store";
import { useGitStore } from "./use-git-store";
import { requestRulesSnapshot, setupSubscriptions, cleanupSessionLight } from "./session-subscriptions";

interface ActiveSessionState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  sessionsByProject: Record<string, SessionMeta[]>;
  sessionReady: Record<string, boolean>;
  lastActiveSessionByProject: Record<string, string>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;
  fetchInitialState: (sessionId: string) => void;
}

type SetState = StoreApi<ActiveSessionState>["setState"];
type GetState = StoreApi<ActiveSessionState>["getState"];

interface ActiveSessionLogger {
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
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
  ? (id: string | null, force?: boolean, options?: { skipCleanup?: boolean; forceNewProcess?: boolean }) => void
  : never {
  return (id, force, options) => {
        const tSwitchStart = performance.now();
        const prevId = get().activeSessionId;
        if (!force && prevId === id) return;
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

            const isAgentKnownRunning = isAgentStarted(id);

            if (isAgentKnownRunning) {
              perfLog.info("[switch] HOT (cached): agent.start SKIPPED", { sessionId: id });

              set((s) => {
                const projectId = s.activeProjectId;
                if (!projectId) return {};
                return {
                  sessionReady: { ...s.sessionReady, [id]: true },
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
              .then((result) => {
                const isHot = result.status === "already_running";

                perfLog.info("[switch] agent.start done", {
                  sessionId: id,
                  status: result.status,
                  isHot,
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
                      sessionReady: { ...s.sessionReady, [id]: true },
                      projectStartFailed: { ...s.projectStartFailed, [projectId]: false },
                      projectStartError: { ...s.projectStartError, [projectId]: "" },
                    };
                  });
                  markAgentStarted(id);

                  requestRulesSnapshot(id);
                  get().fetchInitialState(id);

                  if (isHot) {
                    const cachedMsgs = useChatStore.getState().messagesBySession[id] || [];
                    const hasCached = cachedMsgs.some(
                      (m: { role: string; tokenUsage?: unknown }) =>
                        m.role === "user" || (m.role === "assistant" && m.tokenUsage),
                    );
                    const loadPromise: Promise<void> = hasCached
                      ? (useChatStore
                          .getState()
                          ._backgroundRefreshMessages(id, session.sessionPath) ?? Promise.resolve())
                      : useChatStore.getState().loadSessionMessages(id, {
                          force: true,
                          sessionPath: session.sessionPath,
                        });

                    loadPromise
                      .catch(() => {})
                      .then(() => {
                        return apiClient.call("agent.replayHoldEvents", { sessionId: id });
                      })
                      .then(() => {
                        perfLog.info("[switch] === HOT SWITCH COMPLETE ===", {
                          sessionId: id,
                          totalMs: Math.round(performance.now() - tSwitchStart),
                        });
                      })
                      .catch((err: unknown) => {
                        log.warn("load+replay failed in hot switch", {
                          sessionId: id,
                          err: err instanceof Error ? err.message : String(err),
                        });
                      });
                  } else {
                    perfLog.info("[switch] COLD: loadSessionMessages begin", {
                      sessionId: id,
                    });
                    const tLoad = performance.now();
                    useChatStore
                      .getState()
                      .loadSessionMessages(id, {
                        force: true,
                        sessionPath: session.sessionPath,
                      })
                      .then(() => {
                        perfLog.info("[switch] COLD: loadSessionMessages done", {
                          sessionId: id,
                          count: useChatStore.getState().messagesBySession[id]?.length,
                          ms: Math.round(performance.now() - tLoad),
                        });
                        return apiClient.call("agent.replayHoldEvents", { sessionId: id });
                      })
                      .then(() => {
                        perfLog.info("[switch] === COLD SWITCH COMPLETE ===", {
                          sessionId: id,
                          totalMs: Math.round(performance.now() - tSwitchStart),
                        });
                      })
                      .catch((e) => {
                        log.error("COLD switch load+replay failed", {
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
                clearAgentStarted(id);
                log.error("agent.start failed", {
                  sessionId: id,
                  err: err instanceof Error ? err.message : String(err),
                });
                set((s) => {
                  const projectId = s.activeProjectId;
                  if (!projectId) return {};
                  return {
                    projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                    projectStartError: {
                      ...s.projectStartError,
                      [projectId]: err instanceof Error ? err.message : String(err),
                    },
                    sessionReady: { ...s.sessionReady, [id]: false },
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
                sessionReady: { ...s.sessionReady, [id]: false },
                projectStartFailed: { ...s.projectStartFailed, [projectId]: true },
                projectStartError: { ...s.projectStartError, [projectId]: errMsg },
              };
            });
          });
      
  };
}
