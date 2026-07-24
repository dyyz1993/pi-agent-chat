import { create } from "zustand";
import type {
  SupervisorStatus,
  SupervisorChannelEvent,
  TaskReport,
  TriggerRecord,
} from "../../shared/modules/supervisor";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("supervisor");

const statusPromises = new Map<string, Promise<void>>();
const taskReportPromises = new Map<string, Promise<void>>();
const triggerHistoryPromises = new Map<string, Promise<void>>();
const loadedStatusSessions = new Set<string>();
const loadedTaskReportSessions = new Set<string>();
const loadedTriggerHistoryKeys = new Set<string>();

export interface SupervisorSessionState {
  status: SupervisorStatus | null;
  taskReports: TaskReport[];
  triggerRecords: TriggerRecord[];
}

interface SupervisorState {
  bySession: Record<string, SupervisorSessionState>;

  fetchStatus: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  setGoal: (sessionId: string, objective: string) => Promise<"ok" | "blocked" | "error">;
  clearGoal: (sessionId: string, reason?: string) => Promise<void>;
  refineGoal: (
    sessionId: string,
    objective: string,
  ) => Promise<{ success: boolean; objective?: string; error?: string }>;
  forceContinue: (sessionId: string, reason?: string) => Promise<void>;
  requestPause: (sessionId: string, delayMs?: number, reason?: string) => Promise<void>;
  cancelPause: (sessionId: string) => Promise<void>;
  enable: (sessionId: string) => Promise<void>;
  disable: (sessionId: string) => Promise<void>;
  fetchTaskReport: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  fetchTriggerHistory: (
    sessionId: string,
    limit?: number,
    options?: { force?: boolean },
  ) => Promise<void>;
  handleEvent: (sessionId: string, event: SupervisorChannelEvent) => void;
  clearSession: (sessionId: string) => void;
}

const emptySession = (): SupervisorSessionState => ({
  status: null,
  taskReports: [],
  triggerRecords: [],
});

function updateSession(
  bySession: Record<string, SupervisorSessionState>,
  sessionId: string,
  updater: (session: SupervisorSessionState) => SupervisorSessionState,
): Record<string, SupervisorSessionState> {
  const session = bySession[sessionId] ?? emptySession();
  return { ...bySession, [sessionId]: updater(session) };
}

function mergeTriggerRecords(
  existing: TriggerRecord[],
  incoming: TriggerRecord[],
): TriggerRecord[] {
  const byKey = new Map<string, TriggerRecord>();
  for (const record of existing) {
    byKey.set(String(record.seq), record);
  }
  for (const record of incoming) {
    byKey.set(String(record.seq), record);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const startedDelta = a.startedAt - b.startedAt;
    return startedDelta !== 0 ? startedDelta : a.seq - b.seq;
  });
}

export const useSupervisorStore = create<SupervisorState>()((set) => ({
  bySession: {},

  fetchStatus: async (sessionId: string, options?: { force?: boolean }) => {
    if (!options?.force && loadedStatusSessions.has(sessionId)) return;
    const existingPromise = statusPromises.get(sessionId);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        const status = (await apiClient.call("supervisor.getStatus", {
          sessionId,
        })) as SupervisorStatus;
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            status,
          })),
        }));
        loadedStatusSessions.add(sessionId);
      } catch (err) {
        log.warn("fetchStatus failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        statusPromises.delete(sessionId);
      }
    })();

    statusPromises.set(sessionId, promise);
    return promise;
  },

  setGoal: async (sessionId: string, objective: string): Promise<"ok" | "blocked" | "error"> => {
    try {
      const result = (await apiClient.call("supervisor.setGoal", {
        sessionId,
        objective,
      })) as { goal: SupervisorStatus["goal"] };
      const goalStatus = result.goal?.status;
      set((s) => ({
        bySession: updateSession(s.bySession, sessionId, (session) => ({
          ...session,
          status: session.status
            ? { ...session.status, goal: result.goal, lastGoldResult: undefined }
            : {
                enabled: true,
                state: "idle" as const,
                continueCount: 0,
                maxContinueCount: 0,
                activeGuards: [],
                goal: result.goal,
              },
        })),
      }));
      return goalStatus === "blocked" ? "blocked" : "ok";
    } catch (err) {
      log.warn("setGoal failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return "error";
    }
  },

  clearGoal: async (sessionId: string, reason?: string) => {
    set((s) => ({
      bySession: updateSession(s.bySession, sessionId, (session) => ({
        ...session,
        status: session.status
          ? { ...session.status, goal: undefined, lastGoldResult: undefined }
          : session.status,
      })),
    }));
    try {
      await apiClient.call("supervisor.clearGoal", { sessionId, reason });
    } catch (err) {
      log.warn("clearGoal failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  refineGoal: async (
    sessionId: string,
    objective: string,
  ): Promise<{ success: boolean; objective?: string; error?: string }> => {
    try {
      const result = (await apiClient.call("supervisor.refineGoal", {
        sessionId,
        objective,
      })) as { success: boolean; objective?: string; error?: string };

      if (!result.success) {
        log.warn("refineGoal returned error", {
          sessionId,
          error: result.error,
        });
      }
      return result;
    } catch (err) {
      log.warn("refineGoal failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  forceContinue: async (sessionId: string, reason?: string) => {
    try {
      await apiClient.call("supervisor.forceContinue", { sessionId, reason });
    } catch (err) {
      log.warn("forceContinue failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  requestPause: async (sessionId: string, delayMs?: number, reason?: string) => {
    try {
      await apiClient.call("supervisor.requestPause", { sessionId, delayMs, reason });
    } catch (err) {
      log.warn("requestPause failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  cancelPause: async (sessionId: string) => {
    try {
      await apiClient.call("supervisor.cancelPause", { sessionId });
    } catch (err) {
      log.warn("cancelPause failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  enable: async (sessionId: string) => {
    try {
      const result = (await apiClient.call("supervisor.enable", {
        sessionId,
      })) as { enabled: boolean };
      if (result.enabled) {
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            status: session.status
              ? { ...session.status, enabled: true, state: "idle" as const }
              : {
                  enabled: true,
                  state: "idle" as const,
                  continueCount: 0,
                  maxContinueCount: 0,
                  activeGuards: [],
                },
          })),
        }));
      }
    } catch (err) {
      log.warn("enable failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  disable: async (sessionId: string) => {
    try {
      const result = (await apiClient.call("supervisor.disable", {
        sessionId,
      })) as { disabled: boolean };
      if (result.disabled) {
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            status: session.status
              ? { ...session.status, enabled: false, state: "disabled" as const }
              : {
                  enabled: false,
                  state: "disabled" as const,
                  continueCount: 0,
                  maxContinueCount: 0,
                  activeGuards: [],
                },
          })),
        }));
      }
    } catch (err) {
      log.warn("disable failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  },

  fetchTaskReport: async (sessionId: string, options?: { force?: boolean }) => {
    if (!options?.force && loadedTaskReportSessions.has(sessionId)) return;
    const existingPromise = taskReportPromises.get(sessionId);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        const result = (await apiClient.call("supervisor.getTaskReport", {
          sessionId,
        })) as { tasks: TaskReport[] };
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            taskReports: result.tasks,
          })),
        }));
        loadedTaskReportSessions.add(sessionId);
      } catch (err) {
        log.warn("fetchTaskReport failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        taskReportPromises.delete(sessionId);
      }
    })();

    taskReportPromises.set(sessionId, promise);
    return promise;
  },

  fetchTriggerHistory: async (sessionId: string, limit?: number, options?: { force?: boolean }) => {
    const key = `${sessionId}:${limit ?? "default"}`;
    if (!options?.force && loadedTriggerHistoryKeys.has(key)) return;
    const existingPromise = triggerHistoryPromises.get(key);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      try {
        const result = (await apiClient.call("supervisor.getTriggerHistory", {
          sessionId,
          limit,
        })) as { triggers: TriggerRecord[] };
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            triggerRecords: mergeTriggerRecords(session.triggerRecords, result.triggers),
          })),
        }));
        loadedTriggerHistoryKeys.add(key);
      } catch (err) {
        log.warn("fetchTriggerHistory failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      } finally {
        triggerHistoryPromises.delete(key);
      }
    })();

    triggerHistoryPromises.set(key, promise);
    return promise;
  },

  handleEvent: (sessionId: string, event: SupervisorChannelEvent) => {
    switch (event.type) {
      case "statusChanged":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            status: event.status,
          })),
        }));
        break;
      case "pauseRequested":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => {
            if (!session.status) return session;
            return {
              ...session,
              status: {
                ...session.status,
                state: "paused",
                pendingPause: {
                  scheduledAt: Date.now() + event.delayMs,
                  delayMs: event.delayMs,
                  reason: event.reason,
                },
              },
            };
          }),
        }));
        break;
      case "pauseCancelled":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => {
            if (!session.status) return session;
            return {
              ...session,
              status: {
                ...session.status,
                state: "idle",
                pendingPause: undefined,
              },
            };
          }),
        }));
        break;
      case "continueTriggered":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => {
            if (!session.status) return session;
            return {
              ...session,
              status: {
                ...session.status,
                state: "continuing",
                continueCount: session.status.continueCount + 1,
                pendingPause: undefined,
              },
            };
          }),
        }));
        break;
      case "taskReport":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            taskReports: event.tasks,
          })),
        }));
        break;
      case "goalChanged":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            status: session.status
              ? {
                  ...session.status,
                  goal: event.goal,
                  lastGoldResult:
                    event.goal && session.status.lastGoldResult?.goalId === event.goal.id
                      ? session.status.lastGoldResult
                      : undefined,
                }
              : event.goal
                ? {
                    enabled: true,
                    state: "idle" as const,
                    continueCount: 0,
                    maxContinueCount: 0,
                    activeGuards: [],
                    goal: event.goal,
                  }
                : null,
          })),
        }));
        break;
      case "goldResult":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            status: session.status
              ? { ...session.status, lastGoldResult: event }
              : {
                  enabled: true,
                  state: "idle" as const,
                  continueCount: 0,
                  maxContinueCount: 0,
                  activeGuards: [],
                  lastGoldResult: event,
                },
          })),
        }));
        break;
      case "triggerRecord":
        set((s) => ({
          bySession: updateSession(s.bySession, sessionId, (session) => ({
            ...session,
            triggerRecords: mergeTriggerRecords(session.triggerRecords, [event.record]),
          })),
        }));
        break;
    }
  },

  clearSession: (sessionId: string) => {
    loadedStatusSessions.delete(sessionId);
    loadedTaskReportSessions.delete(sessionId);
    for (const key of Array.from(loadedTriggerHistoryKeys)) {
      if (key.startsWith(`${sessionId}:`)) loadedTriggerHistoryKeys.delete(key);
    }
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession;
      return { bySession: rest };
    });
  },
}));
