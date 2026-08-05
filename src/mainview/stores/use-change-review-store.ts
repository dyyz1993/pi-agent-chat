import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";
import { useGitStore } from "./use-git-store";
import type { ApprovalResult, PendingChangeResult } from "../../shared/modules/change-review";
import { getEffectiveSessionId } from "../lib/effective-session";
import { useSubagentStore } from "./use-subagent-store";

export type PendingChange = PendingChangeResult;
export type ReviewApproval = ApprovalResult;

export interface ChildReviewSummary {
  parentSessionId: string;
  subSessionId: string;
  subSessionPath: string;
  title: string;
  pendingCount: number;
}

/** In-flight dedup promise by session — prevents triple-fire without crossing parent/child views. */
const _fetchPendingPromises = new Map<string, Promise<void>>();

/**
 * In-flight action tracking.
 * Key = `${action}:${path}` (e.g. "approve:foo.ts"), value = active promise.
 * Prevents duplicate RPC calls when user rapidly clicks the same button.
 */
const _inFlight = new Map<string, Promise<void>>();

function actionKey(action: string, path: string): string {
  return `${action}:${path}`;
}

function findKnownSessionPath(sessionId: string): string | undefined {
  const sessionState = useSessionStore.getState();
  const session = Object.values(sessionState.sessionsByProject ?? {})
    .flat()
    .find((item) => item.sessionId === sessionId);
  if (session?.sessionPath) return session.sessionPath;

  return Object.values(useSubagentStore.getState().subsessionsByParent ?? {})
    .flat()
    .find((item) => item.sessionId === sessionId)?.sessionPath;
}

function findParentSessionPath(sessionId: string): string | undefined {
  return Object.values(useSessionStore.getState().sessionsByProject ?? {})
    .flat()
    .find((item) => item.sessionId === sessionId)?.sessionPath;
}

function formatSubtaskTitle(sub: { description?: string; instruction?: string; sessionId: string }): string {
  const description = sub.description?.trim();
  if (description) return description;
  const instruction = sub.instruction?.trim();
  if (instruction) return instruction.slice(0, 60);
  return sub.sessionId.slice(0, 8);
}

interface ChangeReviewState {
  open: boolean;
  changes: PendingChange[];
  approvals: ReviewApproval[];
  childReviewSummaries: ChildReviewSummary[];
  loading: boolean;
  childReviewLoading: boolean;
  selectedPath: string | null;
  /** Paths currently being approved/rejected — for disabling buttons to prevent dup clicks */
  processingPaths: Set<string>;

  setOpen: (open: boolean) => void;
  setChanges: (changes: PendingChange[]) => void;
  setApprovals: (approvals: ReviewApproval[]) => void;
  setChildReviewSummaries: (summaries: ChildReviewSummary[]) => void;
  setLoading: (loading: boolean) => void;
  setSelectedPath: (path: string | null) => void;
  fetchPending: (sessionId?: string | null) => Promise<void>;
  fetchChildReviewSummaries: (parentSessionId?: string | null) => Promise<void>;
  approveChange: (path: string) => Promise<void>;
  rejectChange: (path: string) => Promise<void>;
  approveAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  clearAll: () => void;
}

export const useChangeReviewStore = create<ChangeReviewState>()((set, get) => ({
  open: false,
  changes: [],
  approvals: [],
  childReviewSummaries: [],
  loading: false,
  childReviewLoading: false,
  selectedPath: null,
  processingPaths: new Set(),

  setOpen: (open) => set({ open }),

  setChanges: (changes) => set({ changes }),

  setApprovals: (approvals) => set({ approvals }),

  setChildReviewSummaries: (childReviewSummaries) => set({ childReviewSummaries }),

  setLoading: (loading) => set({ loading }),

  setSelectedPath: (selectedPath) => set({ selectedPath }),

  fetchPending: async (targetSessionId) => {
    const sessionId = targetSessionId ?? getEffectiveSessionId();
    if (!sessionId) return;
    const existingPromise = _fetchPendingPromises.get(sessionId);
    if (existingPromise) return existingPromise;
    set({ loading: true });

    const promise = (async () => {
      try {
        const sessionPath = findKnownSessionPath(sessionId);

        const baseParams = {
          sessionId,
          ...(sessionPath ? { sessionPath } : {}),
        };

        const approvalsResult = await apiClient.call("change-review.approvals", baseParams);
        const approvals = (
          Array.isArray(approvalsResult) ? approvalsResult : (approvalsResult?.items ?? [])
        ) as ReviewApproval[];

        const pendingResult = await apiClient.call("change-review.pending", baseParams);
        const pending = (
          Array.isArray(pendingResult) ? pendingResult : (pendingResult?.items ?? [])
        ) as PendingChange[];

        set({
          approvals,
          changes: pending,
          loading: false,
        });
      } catch {
        set({ approvals: [], changes: [], loading: false });
      }
    })();
    _fetchPendingPromises.set(sessionId, promise);

    try {
      await promise;
    } finally {
      _fetchPendingPromises.delete(sessionId);
    }
  },

  fetchChildReviewSummaries: async (targetParentSessionId) => {
    const parentSessionId = targetParentSessionId ?? useSessionStore.getState().activeSessionId;
    if (!parentSessionId) return;

    const parentSessionPath = findParentSessionPath(parentSessionId);
    if (!parentSessionPath) {
      set({ childReviewSummaries: [], childReviewLoading: false });
      return;
    }

    const subagentStore = useSubagentStore.getState();
    const cachedSubsessions = subagentStore.subsessionsByParent[parentSessionPath];
    const loadedSubsessions =
      cachedSubsessions ?? (await subagentStore.loadSubsessions(parentSessionPath));
    const subsessions = loadedSubsessions.filter((sub) => {
      return Boolean(sub.sessionId && sub.sessionPath);
    });

    if (subsessions.length === 0) {
      set({ childReviewSummaries: [], childReviewLoading: false });
      return;
    }

    set({ childReviewLoading: true });
    try {
      const summaries = await Promise.all(
        subsessions.map(async (sub) => {
          try {
            const pendingResult = await apiClient.call("change-review.pending", {
              sessionId: sub.sessionId,
              sessionPath: sub.sessionPath,
            });
            const pending = (
              Array.isArray(pendingResult) ? pendingResult : (pendingResult?.items ?? [])
            ) as PendingChange[];
            const pendingCount = pending.filter((change) => change.status === "pending").length;
            if (pendingCount === 0) return null;
            return {
              parentSessionId,
              subSessionId: sub.sessionId,
              subSessionPath: sub.sessionPath,
              title: formatSubtaskTitle(sub),
              pendingCount,
            } satisfies ChildReviewSummary;
          } catch {
            return null;
          }
        }),
      );

      set({
        childReviewSummaries: summaries.filter((summary): summary is ChildReviewSummary =>
          Boolean(summary),
        ),
        childReviewLoading: false,
      });
    } catch {
      set({ childReviewSummaries: [], childReviewLoading: false });
    }
  },

  approveChange: async (path) => {
    const sessionId = getEffectiveSessionId();
    if (!sessionId) return;

    const key = actionKey(`approve:${sessionId}`, path);
    const existing = _inFlight.get(key);
    if (existing) return existing;

    set((s) => ({
      processingPaths: new Set(s.processingPaths).add(path),
    }));

    const promise = (async () => {
      try {
        const result = await apiClient.call("change-review.approve", { sessionId, path });
        if (!result.ok) {
          useNotificationStore.getState().push({
            message: `Approve failed: ${result.error ?? "unknown error"}`,
            level: "error",
          });
          return;
        }
        await get().fetchPending(sessionId);
        useGitStore.getState().clearDiff();
      } catch (err) {
        useNotificationStore.getState().push({
          message: `Approve failed: ${err instanceof Error ? err.message : String(err)}`,
          level: "error",
        });
      } finally {
        _inFlight.delete(key);
        set((s) => {
          const next = new Set(s.processingPaths);
          next.delete(path);
          return { processingPaths: next };
        });
      }
    })();

    _inFlight.set(key, promise);
    return promise;
  },

  rejectChange: async (path) => {
    const sessionId = getEffectiveSessionId();
    if (!sessionId) return;

    const key = actionKey(`reject:${sessionId}`, path);
    const existing = _inFlight.get(key);
    if (existing) return existing;

    set((s) => ({
      processingPaths: new Set(s.processingPaths).add(path),
    }));

    const promise = (async () => {
      try {
        const result = await apiClient.call("change-review.reject", { sessionId, path });
        if (!result.ok) {
          useNotificationStore.getState().push({
            message: `Reject failed: ${result.error ?? "unknown error"}`,
            level: "error",
          });
          return;
        }
        await get().fetchPending(sessionId);
        useGitStore.getState().clearDiff();
      } catch (err) {
        useNotificationStore.getState().push({
          message: `Reject failed: ${err instanceof Error ? err.message : String(err)}`,
          level: "error",
        });
      } finally {
        _inFlight.delete(key);
        set((s) => {
          const next = new Set(s.processingPaths);
          next.delete(path);
          return { processingPaths: next };
        });
      }
    })();

    _inFlight.set(key, promise);
    return promise;
  },

  approveAll: async () => {
    const sessionId = getEffectiveSessionId();
    if (!sessionId) return;
    const pending = get().changes.filter((c) => c.status === "pending");
    if (pending.length === 0) return;
    try {
      await apiClient.call("change-review.approveAll", { sessionId });
      await get().fetchPending(sessionId);
    } catch (err) {
      useNotificationStore.getState().push({
        message: `Approve all failed: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  rejectAll: async () => {
    const sessionId = getEffectiveSessionId();
    if (!sessionId) return;
    const pending = get().changes.filter((c) => c.status === "pending");
    if (pending.length === 0) return;
    try {
      const result = await apiClient.call("change-review.rejectAll", { sessionId });
      await get().fetchPending(sessionId);
      if (result.rolledBack > 0) {
        useNotificationStore.getState().push({
          message: `Rejected ${result.count} changes, ${result.rolledBack} files rolled back`,
          level: "info",
        });
      }
    } catch (err) {
      useNotificationStore.getState().push({
        message: `Reject all failed: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  clearAll: () =>
    set({
      open: false,
      changes: [],
      approvals: [],
      childReviewSummaries: [],
      selectedPath: null,
      loading: false,
      childReviewLoading: false,
      processingPaths: new Set(),
    }),
}));
