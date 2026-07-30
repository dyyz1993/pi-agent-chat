import { create } from "zustand";
import type {
  GoalDraftContract,
  GoalVendorStatus,
  GoalVendorTaskItem,
  GoalVendorTriggerRecord,
  GoalChannelEvent,
} from "../../shared/modules/goal";
import { apiClient } from "../lib/api-client";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("goal");

const statusPromises = new Map<string, Promise<void>>();
const taskReportPromises = new Map<string, Promise<void>>();
const triggerHistoryPromises = new Map<string, Promise<void>>();
const loadedStatusSessions = new Set<string>();
const loadedTaskReportSessions = new Set<string>();
const loadedTriggerHistoryKeys = new Set<string>();

export interface GoalSessionState {
  status: GoalVendorStatus | null;
  taskReports: GoalVendorTaskItem[];
  triggerRecords: GoalVendorTriggerRecord[];
}

interface GoalStoreState {
  bySession: Record<string, GoalSessionState>;

  fetchStatus: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  startSetup: (
    sessionId: string,
    objective: string,
  ) => Promise<{ started: boolean; goalId?: string; error?: string }>;
  submitContract: (
    sessionId: string,
    contract: GoalDraftContract,
  ) => Promise<{ submitted: boolean; goalId?: string; status?: string; error?: string }>;
  approveContract: (sessionId: string) => Promise<{ approved: boolean; error?: string }>;
  approveAuthorityAmendment: (
    sessionId: string,
  ) => Promise<{ approved: boolean; count?: number; error?: string }>;
  rejectContract: (sessionId: string, reason?: string) => Promise<{ rejected: boolean }>;
  clearGoal: (sessionId: string, reason?: string) => Promise<void>;
  forceContinue: (sessionId: string, reason?: string) => Promise<void>;
  enable: (sessionId: string) => Promise<void>;
  disable: (sessionId: string) => Promise<void>;
  fetchTaskReport: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  fetchTriggerHistory: (
    sessionId: string,
    limit?: number,
    options?: { force?: boolean },
  ) => Promise<void>;
  refineGoal: (
    sessionId: string,
    objective: string,
  ) => Promise<{ success: boolean; objective?: string; error?: string }>;
  handleEvent: (sessionId: string, event: GoalChannelEvent) => void;
  clearSession: (sessionId: string) => void;
}

const emptySession = (): GoalSessionState => ({
  status: null,
  taskReports: [],
  triggerRecords: [],
});

function updateSession(
  bySession: Record<string, GoalSessionState>,
  sessionId: string,
  updater: (session: GoalSessionState) => GoalSessionState,
): Record<string, GoalSessionState> {
  const session = bySession[sessionId] ?? emptySession();
  return { ...bySession, [sessionId]: updater(session) };
}

function mergeTriggerRecords(
  existing: GoalVendorTriggerRecord[],
  incoming: GoalVendorTriggerRecord[],
): GoalVendorTriggerRecord[] {
  const byKey = new Map<string, GoalVendorTriggerRecord>();
  for (const record of existing) {
    byKey.set(String(record.seq), record);
  }
  for (const record of incoming) {
    byKey.set(String(record.seq), record);
  }
  return Array.from(byKey.values()).sort((a, b) => a.seq - b.seq);
}

export const useGoalStore = create<GoalStoreState>()((set) => ({
  bySession: {},

  fetchStatus: async (sessionId, options) => {
    if (!options?.force && loadedStatusSessions.has(sessionId)) return;
    if (statusPromises.has(sessionId)) {
      await statusPromises.get(sessionId);
      return;
    }
    const promise = (async () => {
      try {
        const status = (await apiClient.call("goal.getStatus", {
          sessionId,
        })) as GoalVendorStatus;
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => ({ ...s, status })),
        }));
        loadedStatusSessions.add(sessionId);
      } catch (error) {
        log.warn("Failed to fetch goal status", { sessionId, error });
      }
    })();
    statusPromises.set(sessionId, promise);
    await promise;
    statusPromises.delete(sessionId);
  },

  startSetup: async (sessionId, objective) => {
    try {
      const result = (await apiClient.call("goal.startSetup", {
        sessionId,
        objective,
      })) as { started: boolean; goalId?: string; error?: string };
      if (result.started) {
        loadedStatusSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true });
      }
      return result;
    } catch (error) {
      log.warn("Failed to start goal setup", { sessionId, error });
      return { started: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  submitContract: async (sessionId, contract) => {
    try {
      const result = (await apiClient.call("goal.submitContract", {
        sessionId,
        contract,
      })) as { submitted: boolean; goalId?: string; status?: string; error?: string };
      if (result.submitted) {
        loadedStatusSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true });
      }
      return result;
    } catch (error) {
      log.warn("Failed to submit goal contract", { sessionId, error });
      return { submitted: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  approveContract: async (sessionId) => {
    try {
      const result = (await apiClient.call("goal.approveContract", {
        sessionId,
      })) as { approved: boolean; error?: string };
      if (result.approved) {
        loadedStatusSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true });
      }
      return result;
    } catch (error) {
      log.warn("Failed to approve goal contract", { sessionId, error });
      return { approved: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  approveAuthorityAmendment: async (sessionId) => {
    try {
      const result = (await apiClient.call("goal.approveAuthorityAmendment", {
        sessionId,
      })) as { approved: boolean; count?: number; error?: string };
      if (result.approved) {
        loadedStatusSessions.delete(sessionId);
        loadedTaskReportSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true });
      }
      return result;
    } catch (error) {
      log.warn("Failed to approve goal authority amendment", { sessionId, error });
      return { approved: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  rejectContract: async (sessionId, reason) => {
    try {
      const result = (await apiClient.call("goal.rejectContract", {
        sessionId,
        reason,
      })) as { rejected: boolean };
      return result;
    } catch (error) {
      log.warn("Failed to reject goal contract", { sessionId, error });
      return { rejected: false };
    }
  },

  clearGoal: async (sessionId, reason) => {
    try {
      await apiClient.call("goal.clearGoal", { sessionId, reason });
      loadedStatusSessions.delete(sessionId);
      loadedTaskReportSessions.delete(sessionId);
      loadedTriggerHistoryKeys.delete(sessionId);
      await useGoalStore.getState().fetchStatus(sessionId, { force: true });
    } catch (error) {
      log.warn("Failed to clear goal", { sessionId, error });
    }
  },

  forceContinue: async (sessionId, reason) => {
    try {
      await apiClient.call("goal.forceContinue", { sessionId, reason });
    } catch (error) {
      log.warn("Failed to force-continue goal", { sessionId, error });
    }
  },

  enable: async (sessionId) => {
    try {
      await apiClient.call("goal.enable", { sessionId });
      loadedStatusSessions.delete(sessionId);
      await useGoalStore.getState().fetchStatus(sessionId, { force: true });
    } catch (error) {
      log.warn("Failed to enable goal", { sessionId, error });
    }
  },

  disable: async (sessionId) => {
    try {
      await apiClient.call("goal.disable", { sessionId });
      loadedStatusSessions.delete(sessionId);
      await useGoalStore.getState().fetchStatus(sessionId, { force: true });
    } catch (error) {
      log.warn("Failed to disable goal", { sessionId, error });
    }
  },

  fetchTaskReport: async (sessionId, options) => {
    if (!options?.force && loadedTaskReportSessions.has(sessionId)) return;
    if (taskReportPromises.has(sessionId)) {
      await taskReportPromises.get(sessionId);
      return;
    }
    const promise = (async () => {
      try {
        const result = (await apiClient.call("goal.getTaskReport", {
          sessionId,
        })) as { tasks: GoalVendorTaskItem[] };
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => ({
            ...s,
            taskReports: result.tasks ?? [],
          })),
        }));
        loadedTaskReportSessions.add(sessionId);
      } catch (error) {
        log.warn("Failed to fetch goal task report", { sessionId, error });
      }
    })();
    taskReportPromises.set(sessionId, promise);
    await promise;
    taskReportPromises.delete(sessionId);
  },

  fetchTriggerHistory: async (sessionId, limit, options) => {
    const key = `${sessionId}:${limit ?? "default"}`;
    if (!options?.force && loadedTriggerHistoryKeys.has(key)) return;
    if (triggerHistoryPromises.has(key)) {
      await triggerHistoryPromises.get(key);
      return;
    }
    const promise = (async () => {
      try {
        const result = (await apiClient.call("goal.getTriggerHistory", {
          sessionId,
          limit,
        })) as { triggers: GoalVendorTriggerRecord[] };
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => ({
            ...s,
            triggerRecords: mergeTriggerRecords(s.triggerRecords, result.triggers ?? []),
          })),
        }));
        loadedTriggerHistoryKeys.add(key);
      } catch (error) {
        log.warn("Failed to fetch goal trigger history", { sessionId, error });
      }
    })();
    triggerHistoryPromises.set(key, promise);
    await promise;
    triggerHistoryPromises.delete(key);
  },

  refineGoal: async (sessionId, objective) => {
    try {
      return (await apiClient.call("goal.refineGoal", {
        sessionId,
        objective,
      })) as { success: boolean; objective?: string; error?: string };
    } catch (error) {
      log.warn("Failed to refine goal", { sessionId, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  handleEvent: (sessionId, event) => {
    switch (event.type) {
      case "statusChanged": {
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => ({
            ...s,
            status: event.status,
          })),
        }));
        break;
      }
      case "goalChanged": {
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => {
            if (!s.status) return s;
            return {
              ...s,
              status: {
                ...s.status,
                goalId: event.goalId,
                rawStatus: event.status ?? s.status.rawStatus,
              },
            };
          }),
        }));
        break;
      }
      case "taskReport": {
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => ({
            ...s,
            taskReports: event.tasks ?? [],
          })),
        }));
        break;
      }
      case "continueTriggered": {
        set((state) => ({
          bySession: updateSession(state.bySession, sessionId, (s) => {
            if (!s.status) return s;
            return {
              ...s,
              status: {
                ...s.status,
                continuationSequence: s.status.continuationSequence + 1,
              },
            };
          }),
        }));
        break;
      }
      default:
        break;
    }
  },

  clearSession: (sessionId) => {
    set((state) => {
      const bySession = { ...state.bySession };
      delete bySession[sessionId];
      return { bySession };
    });
    loadedStatusSessions.delete(sessionId);
    loadedTaskReportSessions.delete(sessionId);
    for (const key of loadedTriggerHistoryKeys) {
      if (key.startsWith(`${sessionId}:`)) loadedTriggerHistoryKeys.delete(key);
    }
    statusPromises.delete(sessionId);
    taskReportPromises.delete(sessionId);
    for (const key of triggerHistoryPromises.keys()) {
      if (key.startsWith(`${sessionId}:`)) triggerHistoryPromises.delete(key);
    }
  },
}));
