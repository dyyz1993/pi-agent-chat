import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type { SnapshotInfo } from "../types";

interface SnapshotTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  contentHash?: string;
}

interface SnapshotFileContent {
  path: string;
  content: string;
  contentHash: string;
}

interface SnapshotState {
  snapshotsBySession: Record<string, SnapshotInfo[]>;
  treeEntriesBySession: Record<string, SnapshotTreeEntry[]>;
  currentTreePath: Record<string, string>;
  fileContentBySession: Record<string, SnapshotFileContent | null>;
  loading: boolean;
  error: string | null;

  fetchSnapshots: (sessionId: string) => Promise<void>;
  getSnapshot: (sessionId: string, snapshotId: string) => Promise<SnapshotInfo | null>;
  rollback: (
    sessionId: string,
    snapshotId: string,
    files?: string[],
  ) => Promise<{ ok: boolean; restoredFiles: string[]; error?: string }>;
  unrevert: (sessionId: string, snapshotId: string) => Promise<{ ok: boolean; error?: string }>;
  navigateTree: (sessionId: string, snapshotId?: string, path?: string) => Promise<void>;
  getFileContent: (sessionId: string, snapshotId: string, filePath: string) => Promise<void>;
  clearSession: (sessionId: string) => void;
}

export const useSnapshotStore = create<SnapshotState>()((set, get) => ({
  snapshotsBySession: {},
  treeEntriesBySession: {},
  currentTreePath: {},
  fileContentBySession: {},
  loading: false,
  error: null,

  fetchSnapshots: async (sessionId) => {
    set({ loading: true, error: null });
    try {
      const snapshots = await apiClient.call("snapshot.list", { sessionId });
      set((s) => ({
        snapshotsBySession: {
          ...s.snapshotsBySession,
          [sessionId]: snapshots,
        },
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  getSnapshot: async (sessionId, snapshotId) => {
    try {
      return await apiClient.call("snapshot.get", { sessionId, snapshotId });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  rollback: async (sessionId, snapshotId, files) => {
    try {
      const result = await apiClient.call("snapshot.rollback", { sessionId, snapshotId, files });
      if (result.ok) {
        await get().fetchSnapshots(sessionId);
      }
      return result;
    } catch (err) {
      return {
        ok: false,
        restoredFiles: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  unrevert: async (sessionId, snapshotId) => {
    try {
      const result = await apiClient.call("snapshot.unrevert", { sessionId, snapshotId });
      if (result.ok) {
        await get().fetchSnapshots(sessionId);
      }
      return result;
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  navigateTree: async (sessionId, snapshotId, path) => {
    set({ loading: true, error: null });
    try {
      const result = await apiClient.call("snapshot.navigateTree", {
        sessionId,
        snapshotId,
        path,
      });
      set((s) => ({
        treeEntriesBySession: {
          ...s.treeEntriesBySession,
          [sessionId]: result.entries,
        },
        currentTreePath: {
          ...s.currentTreePath,
          [sessionId]: result.currentPath,
        },
        loading: false,
      }));
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  getFileContent: async (sessionId, snapshotId, filePath) => {
    try {
      const result = await apiClient.call("snapshot.getTree", { sessionId, snapshotId, filePath });
      set((s) => ({
        fileContentBySession: {
          ...s.fileContentBySession,
          [sessionId]: result,
        },
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  clearSession: (sessionId) => {
    set((s) => {
      const { [sessionId]: _snapshots, ...restSnapshots } = s.snapshotsBySession;
      const { [sessionId]: _tree, ...restTree } = s.treeEntriesBySession;
      const { [sessionId]: _path, ...restPaths } = s.currentTreePath;
      const { [sessionId]: _file, ...restFiles } = s.fileContentBySession;
      return {
        snapshotsBySession: restSnapshots,
        treeEntriesBySession: restTree,
        currentTreePath: restPaths,
        fileContentBySession: restFiles,
      };
    });
  },
}));
