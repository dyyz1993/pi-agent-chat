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

const MAX_SESSIONS = 100;

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

  fetchStatus: (
    sessionId: string,
    options?: { force?: boolean; signal?: AbortSignal },
  ) => Promise<void>;
  startSetup: (
    sessionId: string,
    objective: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ started: boolean; goalId?: string; error?: string }>;
  submitContract: (
    sessionId: string,
    contract: GoalDraftContract,
    options?: { signal?: AbortSignal },
  ) => Promise<{ submitted: boolean; goalId?: string; status?: string; error?: string }>;
  approveContract: (
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ approved: boolean; error?: string }>;
  approveAuthorityAmendment: (
    sessionId: string,
    options?: { signal?: AbortSignal },
  ) => Promise<{ approved: boolean; count?: number; error?: string }>;
  rejectAuthorityAmendment: (
    sessionId: string,
    reason?: string,
  ) => Promise<{ rejected: boolean; error?: string }>;
  rejectContract: (sessionId: string, reason?: string) => Promise<{ rejected: boolean }>;
  getPendingContract: (
    sessionId: string,
  ) => Promise<{
    hasPending: boolean;
    status?: string;
    goalId?: string;
    generation?: number;
    objective?: string;
    criteria?: Array<Record<string, unknown>>;
    plan?: Array<{ id: string; title: string; status: string; criterionIds?: string[] }>;
    verificationChecks?: Array<Record<string, unknown>>;
    authorities?: Array<Record<string, unknown>>;
    constraints?: string[];
    nonGoals?: string[];
    workspaceRoots?: string[];
  }>;
  refineContract: (sessionId: string) => Promise<{ refined: boolean }>;
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

function pruneSessionCaches(sessionId: string): void {
  loadedStatusSessions.delete(sessionId);
  loadedTaskReportSessions.delete(sessionId);
  statusPromises.delete(sessionId);
  taskReportPromises.delete(sessionId);
  for (const key of [...loadedTriggerHistoryKeys]) {
    if (key.startsWith(`${sessionId}:`)) loadedTriggerHistoryKeys.delete(key);
  }
  for (const key of [...triggerHistoryPromises.keys()]) {
    if (key.startsWith(`${sessionId}:`)) triggerHistoryPromises.delete(key);
  }
}

function pruneBySession(
  bySession: Record<string, GoalSessionState>,
): Record<string, GoalSessionState> {
  const keys = Object.keys(bySession);
  if (keys.length <= MAX_SESSIONS) return bySession;

  const excess = keys.length - MAX_SESSIONS;
  const evicted = new Set(keys.slice(0, excess));
  for (const sessionId of evicted) pruneSessionCaches(sessionId);

  const next: Record<string, GoalSessionState> = {};
  for (const key of keys) {
    if (!evicted.has(key)) next[key] = bySession[key];
  }
  return next;
}

function updateSession(
  bySession: Record<string, GoalSessionState>,
  sessionId: string,
  updater: (session: GoalSessionState) => GoalSessionState,
): Record<string, GoalSessionState> {
  const session = bySession[sessionId] ?? emptySession();
  const next = { ...bySession, [sessionId]: updater(session) };
  return pruneBySession(next);
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
    const signal = options?.signal;
    const promise = (async () => {
      try {
        const status = (await apiClient.call(
          "goal.getStatus",
          { sessionId },
          signal ? { signal } : undefined,
        )) as GoalVendorStatus;
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

  startSetup: async (sessionId, objective, options) => {
    const signal = options?.signal;
    try {
      const result = (await apiClient.call(
        "goal.startSetup",
        { sessionId, objective },
        signal ? { signal } : undefined,
      )) as { started: boolean; goalId?: string; error?: string };
      if (result.started) {
        loadedStatusSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true, signal });
      }
      return result;
    } catch (error) {
      log.warn("Failed to start goal setup", { sessionId, error });
      return { started: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  submitContract: async (sessionId, contract, options) => {
    const signal = options?.signal;
    try {
      const result = (await apiClient.call(
        "goal.submitContract",
        { sessionId, contract },
        signal ? { signal } : undefined,
      )) as { submitted: boolean; goalId?: string; status?: string; error?: string };
      if (result.submitted) {
        loadedStatusSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true, signal });
      }
      return result;
    } catch (error) {
      log.warn("Failed to submit goal contract", { sessionId, error });
      return { submitted: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  approveContract: async (sessionId, options) => {
    const signal = options?.signal;
    try {
      const result = (await apiClient.call(
        "goal.approveContract",
        { sessionId },
        signal ? { signal } : undefined,
      )) as { approved: boolean; error?: string };
      if (result.approved) {
        loadedStatusSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true, signal });
      }
      return result;
    } catch (error) {
      log.warn("Failed to approve goal contract", { sessionId, error });
      return { approved: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  approveAuthorityAmendment: async (sessionId, options) => {
    const signal = options?.signal;
    try {
      const result = (await apiClient.call(
        "goal.approveAuthorityAmendment",
        { sessionId },
        signal ? { signal } : undefined,
      )) as { approved: boolean; count?: number; error?: string };
      if (result.approved) {
        loadedStatusSessions.delete(sessionId);
        loadedTaskReportSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true, signal });
      }
      return result;
    } catch (error) {
      log.warn("Failed to approve goal authority amendment", { sessionId, error });
      return { approved: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  rejectAuthorityAmendment: async (sessionId, reason) => {
    try {
      const result = (await apiClient.call("goal.rejectAuthorityAmendment", {
        sessionId,
        reason,
      })) as { rejected: boolean; error?: string };
      if (result.rejected) {
        loadedStatusSessions.delete(sessionId);
        loadedTaskReportSessions.delete(sessionId);
        await useGoalStore.getState().fetchStatus(sessionId, { force: true });
      }
      return result;
    } catch (error) {
      log.warn("Failed to reject goal authority amendment", { sessionId, error });
      return { rejected: false, error: error instanceof Error ? error.message : String(error) };
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

  getPendingContract: async (sessionId) => {
    try {
      const result = (await apiClient.call("goal.getPendingContract", {
        sessionId,
      })) as {
        hasPending: boolean;
        status?: string;
        goalId?: string;
        generation?: number;
        objective?: string;
        criteria?: Array<Record<string, unknown>>;
        plan?: Array<{ id: string; title: string; status: string; criterionIds?: string[] }>;
        verificationChecks?: Array<Record<string, unknown>>;
        authorities?: Array<Record<string, unknown>>;
        constraints?: string[];
        nonGoals?: string[];
        workspaceRoots?: string[];
      };
      return result;
    } catch (error) {
      log.warn("Failed to get pending contract", { sessionId, error });
      return { hasPending: false };
    }
  },

  refineContract: async (sessionId) => {
    try {
      const result = (await apiClient.call("goal.refineContract", { sessionId })) as {
        refined: boolean;
      };
      return result;
    } catch (error) {
      log.warn("Failed to refine goal contract", { sessionId, error });
      return { refined: false };
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
