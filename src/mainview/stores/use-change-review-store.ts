import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";
import { useGitStore } from "./use-git-store";
import type { ApprovalResult, PendingChangeResult } from "../../shared/modules/change-review";

export type PendingChange = PendingChangeResult;
export type ReviewApproval = ApprovalResult;

/** In-flight dedup promise for fetchPending — prevents triple-fire on session switch */
let _fetchPendingPromise: Promise<void> | null = null;

/**
 * In-flight action tracking.
 * Key = `${action}:${path}` (e.g. "approve:foo.ts"), value = active promise.
 * Prevents duplicate RPC calls when user rapidly clicks the same button.
 */
const _inFlight = new Map<string, Promise<void>>();

function actionKey(action: string, path: string): string {
  return `${action}:${path}`;
}

interface ChangeReviewState {
  open: boolean;
  changes: PendingChange[];
  approvals: ReviewApproval[];
  loading: boolean;
  selectedPath: string | null;
  /** Paths currently being approved/rejected — for disabling buttons to prevent dup clicks */
  processingPaths: Set<string>;

  setOpen: (open: boolean) => void;
  setChanges: (changes: PendingChange[]) => void;
  setApprovals: (approvals: ReviewApproval[]) => void;
  setLoading: (loading: boolean) => void;
  setSelectedPath: (path: string | null) => void;
  fetchPending: () => Promise<void>;
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
  loading: false,
  selectedPath: null,
  processingPaths: new Set(),

  setOpen: (open) => set({ open }),

  setChanges: (changes) => set({ changes }),

  setApprovals: (approvals) => set({ approvals }),

  setLoading: (loading) => set({ loading }),

  setSelectedPath: (selectedPath) => set({ selectedPath }),

  fetchPending: async () => {
    if (_fetchPendingPromise) return _fetchPendingPromise;
    const sessionState = useSessionStore.getState();
    const sessionId = sessionState.activeSessionId;
    if (!sessionId) return;
    set({ loading: true });

    _fetchPendingPromise = (async () => {
      try {
        const session = sessionState.sessionsByProject
          ? Object.values(sessionState.sessionsByProject)
              .flat()
              .find((s) => s.sessionId === sessionId)
          : undefined;

        const baseParams = {
          sessionId,
          ...(session?.sessionPath ? { sessionPath: session.sessionPath } : {}),
        };

        const approvalsResult = await apiClient.call("change-review.approvals", baseParams);
        const approvals = (
          Array.isArray(approvalsResult) ? approvalsResult : []
        ) as ReviewApproval[];

        const pendingResult = await apiClient.call("change-review.pending", baseParams);
        const pending = (Array.isArray(pendingResult) ? pendingResult : []) as PendingChange[];

        set({
          approvals,
          changes: pending,
          loading: false,
        });
      } catch {
        set({ approvals: [], changes: [], loading: false });
      }
    })();

    try {
      await _fetchPendingPromise;
    } finally {
      _fetchPendingPromise = null;
    }
  },

  approveChange: async (path) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;

    const key = actionKey("approve", path);
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
        await get().fetchPending();
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
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;

    const key = actionKey("reject", path);
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
        await get().fetchPending();
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
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const pending = get().changes.filter((c) => c.status === "pending");
    if (pending.length === 0) return;
    try {
      await apiClient.call("change-review.approveAll", { sessionId });
      await get().fetchPending();
    } catch (err) {
      useNotificationStore.getState().push({
        message: `Approve all failed: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  rejectAll: async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const pending = get().changes.filter((c) => c.status === "pending");
    if (pending.length === 0) return;
    try {
      const result = await apiClient.call("change-review.rejectAll", { sessionId });
      await get().fetchPending();
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
      selectedPath: null,
      loading: false,
      processingPaths: new Set(),
    }),
}));
