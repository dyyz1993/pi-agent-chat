import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";
import { useGitStore } from "./use-git-store";
import type { PendingChangeResult } from "../../shared/modules/change-review";

export type PendingChange = PendingChangeResult;

interface ChangeReviewState {
  open: boolean;
  changes: PendingChange[];
  loading: boolean;
  selectedPath: string | null;

  setOpen: (open: boolean) => void;
  setChanges: (changes: PendingChange[]) => void;
  setLoading: (loading: boolean) => void;
  setSelectedPath: (path: string | null) => void;
  updateChangeStatus: (path: string, status: PendingChange["status"]) => void;
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
  loading: false,
  selectedPath: null,

  setOpen: (open) => set({ open }),

  setChanges: (changes) => set({ changes }),

  setLoading: (loading) => set({ loading }),

  setSelectedPath: (path) => set({ selectedPath: path }),

  updateChangeStatus: (path, status) =>
    set((s) => ({
      changes: s.changes.map((c) => (c.path === path ? { ...c, status } : c)),
    })),

  fetchPending: async () => {
    const sessionState = useSessionStore.getState();
    const sessionId = sessionState.activeSessionId;
    if (!sessionId) return;
    set({ loading: true });
    try {
      const session = sessionState.sessionsByProject
        ? Object.values(sessionState.sessionsByProject)
            .flat()
            .find((s) => s.sessionId === sessionId)
        : undefined;
      const result = await apiClient.call("change-review.pending", {
        sessionId,
        ...(session?.sessionPath ? { sessionPath: session.sessionPath } : {}),
      });
      const changes = (Array.isArray(result) ? result : []) as PendingChange[];
      set({ changes, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  approveChange: async (path) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      await apiClient.call("change-review.approve", { sessionId, path });
      get().updateChangeStatus(path, "approved");
      useGitStore.getState().clearDiff();
    } catch (err) {
      useNotificationStore.getState().push({
        message: `Approve failed: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  rejectChange: async (path) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      const result = await apiClient.call("change-review.reject", { sessionId, path });
      if (result.rolledBack) {
        set((s) => ({
          changes: s.changes.filter((c) => c.path !== path),
        }));
      } else {
        get().updateChangeStatus(path, "rejected");
      }
      useGitStore.getState().clearDiff();
    } catch (err) {
      useNotificationStore.getState().push({
        message: `Reject failed: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  approveAll: async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const pending = get().changes.filter((c) => c.status === "pending");
    if (pending.length === 0) return;
    try {
      await apiClient.call("change-review.approveAll", { sessionId });
      set((s) => ({
        changes: s.changes.map((c) =>
          c.status === "pending" ? { ...c, status: "approved" as const } : c,
        ),
      }));
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
      // All rolled-back files are removed from pending list
      set({ changes: [] });
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

  clearAll: () => set({ open: false, changes: [], selectedPath: null, loading: false }),
}));
