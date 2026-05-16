import { create } from "zustand";
import type {
  SupervisorStatus,
  SupervisorChannelEvent,
  TaskReport,
} from "../../shared/modules/supervisor";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("supervisor");

export interface SupervisorSessionState {
  status: SupervisorStatus | null;
  taskReports: TaskReport[];
}

interface SupervisorState {
  bySession: Record<string, SupervisorSessionState>;

  fetchStatus: (sessionId: string) => Promise<void>;
  forceContinue: (sessionId: string, reason?: string) => Promise<void>;
  requestPause: (sessionId: string, delayMs?: number, reason?: string) => Promise<void>;
  cancelPause: (sessionId: string) => Promise<void>;
  enable: (sessionId: string) => Promise<void>;
  disable: (sessionId: string) => Promise<void>;
  fetchTaskReport: (sessionId: string) => Promise<void>;
  handleEvent: (sessionId: string, event: SupervisorChannelEvent) => void;
  clearSession: (sessionId: string) => void;
}

const emptySession = (): SupervisorSessionState => ({
  status: null,
  taskReports: [],
});

function updateSession(
  bySession: Record<string, SupervisorSessionState>,
  sessionId: string,
  updater: (session: SupervisorSessionState) => SupervisorSessionState,
): Record<string, SupervisorSessionState> {
  const session = bySession[sessionId] ?? emptySession();
  return { ...bySession, [sessionId]: updater(session) };
}

export const useSupervisorStore = create<SupervisorState>()((set) => ({
  bySession: {},

  fetchStatus: async (sessionId: string) => {
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
    } catch (err) {
      log.warn("fetchStatus failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
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

  fetchTaskReport: async (sessionId: string) => {
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
    } catch (err) {
      log.warn("fetchTaskReport failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
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
    }
  },

  clearSession: (sessionId: string) => {
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession;
      return { bySession: rest };
    });
  },
}));
