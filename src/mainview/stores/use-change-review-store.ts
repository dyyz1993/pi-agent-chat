import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useNotificationStore } from "./use-notification-store";
import { useGitStore } from "./use-git-store";
import type { PendingChangeResult } from "../../shared/modules/change-review";
import { reconstructDiffContent } from "../lib/diff-utils";

export type PendingChange = PendingChangeResult;

/** In-flight dedup promise for fetchPending — prevents triple-fire on session switch */
let _fetchPendingPromise: Promise<void> | null = null;

/** Debounce timer for fetchPending — coalesces rapid turn_end calls */
let _fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const FETCH_DEBOUNCE_MS = 2000;

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
  /** Load diff content for a single file on demand (fallback when batch enrichment misses it) */
  fetchFileDiff: (path: string) => Promise<void>;
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

  setSelectedPath: (selectedPath) => set({ selectedPath }),

  updateChangeStatus: (path, status) =>
    set((s) => ({
      changes: s.changes.map((c) => (c.path === path ? { ...c, status } : c)),
    })),

  fetchPending: (() => {
    const doFetch = async () => {
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

          const result = await apiClient.call("change-review.pending", {
            sessionId,
            ...(session?.sessionPath ? { sessionPath: session.sessionPath } : {}),
          });
          const changes = (Array.isArray(result) ? result : []) as PendingChange[];

          set({ changes, loading: false });

          if (
            changes.length > 0 &&
            changes.every((c) => c.oldContent === null && c.newContent === null)
          ) {
            apiClient
              .call("agent.getBatchDiffs", { sessionId })
              .then((batchResult) => {
                if (batchResult?.files) {
                  const diffMap = new Map<
                    string,
                    { oldContent: string | null; newContent: string | null; unifiedDiff: string | null }
                  >();
                  for (const f of batchResult.files as Array<{
                    path: string;
                    diff: {
                      oldContent: string | null;
                      newContent: string | null;
                      unifiedDiff: string;
                    } | null;
                  }>) {
                    if (f.diff) {
                      const reconstructed = reconstructDiffContent({
                        oldContent: f.diff.oldContent,
                        newContent: f.diff.newContent,
                        unifiedDiff: f.diff.unifiedDiff,
                      });
                      diffMap.set(f.path, {
                        oldContent: reconstructed.oldContent,
                        newContent: reconstructed.newContent,
                        unifiedDiff: f.diff.unifiedDiff,
                      });
                    }
                  }
                  set((s) => ({
                    changes: s.changes.map((c) => {
                      const d = diffMap.get(c.path);
                      if (d) return { ...c, oldContent: d.oldContent, newContent: d.newContent };
                      if (c.fileStatus === "added") return { ...c, oldContent: "" };
                      if (c.fileStatus === "deleted") return { ...c, newContent: "" };
                      return c;
                    }),
                  }));
                }
              })
              .catch(() => {});
            }
        } catch {
          set({ loading: false });
        }
      })();

      try {
        await _fetchPendingPromise;
      } finally {
        _fetchPendingPromise = null;
      }
    };

    return () => {
      if (_fetchDebounceTimer) {
        clearTimeout(_fetchDebounceTimer);
      }
      return new Promise<void>((resolve) => {
        _fetchDebounceTimer = setTimeout(() => {
          _fetchDebounceTimer = null;
          doFetch().then(resolve);
        }, FETCH_DEBOUNCE_MS);
      });
    };
  })(),

  fetchFileDiff: async (path) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const change = get().changes.find((c) => c.path === path);
    if (!change || (change.oldContent !== null && change.newContent !== null)) return;
    try {
      const res = await apiClient.call("agent.getFileDiff", { sessionId, filePath: path });
      if (!res) return;
      const reconstructed = reconstructDiffContent({
        oldContent: res.oldContent ?? null,
        newContent: res.newContent ?? null,
        unifiedDiff: res.unifiedDiff ?? null,
      });
      set((s) => ({
        changes: s.changes.map((c) =>
          c.path === path
            ? { ...c, oldContent: reconstructed.oldContent, newContent: reconstructed.newContent }
            : c,
        ),
      }));
    } catch {
      // Non-critical
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
