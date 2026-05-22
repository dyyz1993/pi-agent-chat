import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";
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
  updateChangeStatus: (turnIndex: number, path: string, status: PendingChange["status"]) => void;
  fetchPending: () => Promise<void>;
  approveChange: (turnIndex: number, path: string) => Promise<void>;
  rejectChange: (turnIndex: number, path: string) => Promise<void>;
  approveAll: () => Promise<void>;
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

  updateChangeStatus: (turnIndex, path, status) =>
    set((s) => ({
      changes: s.changes.map((c) =>
        c.turnIndex === turnIndex && c.path === path ? { ...c, status } : c,
      ),
    })),

  fetchPending: async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set({ loading: true });
    try {
      const result = await apiClient.call("change-review.pending", { sessionId });
      const changes = (Array.isArray(result) ? result : []) as PendingChange[];
      set({ changes, loading: false });
    } catch (err) {
      set({ loading: false });
      useNotificationStore.getState().push({
        message: `Failed to fetch pending changes: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  approveChange: async (turnIndex, path) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      await apiClient.call("change-review.approve", { sessionId, turnIndex, path });
      get().updateChangeStatus(turnIndex, path, "approved");
    } catch (err) {
      useNotificationStore.getState().push({
        message: `Approve failed: ${err instanceof Error ? err.message : String(err)}`,
        level: "error",
      });
    }
  },

  rejectChange: async (turnIndex, path) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      await apiClient.call("change-review.reject", { sessionId, turnIndex, path });
      get().updateChangeStatus(turnIndex, path, "rejected");
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

  clearAll: () => set({ open: false, changes: [], selectedPath: null, loading: false }),
}));
