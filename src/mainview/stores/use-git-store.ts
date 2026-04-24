import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useAppStore } from "./use-app-store";

export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitWorktree {
  path: string;
  branch: string;
  isMain: boolean;
}

interface GitState {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  changed: GitFileChange[];
  untracked: string[];
  commits: GitCommit[];
  loadingCommits: boolean;
  currentDiff: { filePath: string; diff: string; oldContent: string; newContent: string } | null;
  loadingDiff: boolean;
  expandedCommits: Set<string>;
  commitFiles: Record<string, GitFileChange[]>;
  loadingCommitFiles: Set<string>;
  branches: GitBranch[];
  loadingBranches: boolean;
  worktrees: GitWorktree[];
  loadingAction: string | null;

  fetchStatus: (repoPath: string) => Promise<void>;
  fetchDiff: (repoPath: string, filePath: string, staged?: boolean) => Promise<void>;
  fetchLog: (repoPath: string) => Promise<void>;
  clearDiff: () => void;
  toggleCommitExpand: (repoPath: string, hash: string) => Promise<void>;
  fetchCommitFileDiff: (repoPath: string, hash: string, filePath: string) => Promise<void>;
  fetchBranches: (repoPath: string) => Promise<void>;
  checkout: (repoPath: string, branch: string) => Promise<void>;
  stageFiles: (repoPath: string, paths: string[]) => Promise<void>;
  unstageFiles: (repoPath: string, paths: string[]) => Promise<void>;
  commit: (repoPath: string, message: string) => Promise<void>;
  push: (repoPath: string) => Promise<void>;
  pull: (repoPath: string) => Promise<void>;
  fetchWorktrees: (repoPath: string) => Promise<void>;
  refresh: (repoPath: string) => Promise<void>;
}

export const useGitStore = create<GitState>((set, get) => ({
  branch: "",
  ahead: 0,
  behind: 0,
  staged: [],
  changed: [],
  untracked: [],
  commits: [],
  loadingCommits: false,
  currentDiff: null,
  loadingDiff: false,
  expandedCommits: new Set(),
  commitFiles: {},
  loadingCommitFiles: new Set(),
  branches: [],
  loadingBranches: false,
  worktrees: [],
  loadingAction: null,

  refresh: async (repoPath) => {
    await get().fetchStatus(repoPath);
  },

  fetchStatus: async (repoPath) => {
    const addLog = useAppStore.getState().addLog;
    try {
      const res = await apiClient.call("git.status", { repoPath });
      set({
        branch: res.branch,
        ahead: res.ahead,
        behind: res.behind,
        staged: res.staged,
        changed: res.changed,
        untracked: res.untracked,
      });
    } catch (err) {
      addLog(`Git status error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  fetchDiff: async (repoPath, filePath, staged) => {
    const addLog = useAppStore.getState().addLog;
    addLog(`Git diff: ${filePath}`);
    set({ loadingDiff: true });
    try {
      const res = await apiClient.call("git.diff", { repoPath, filePath, staged });
      addLog(`Git diff result: ${res.diff.length} chars`);
      set({ currentDiff: res, loadingDiff: false });
    } catch (err) {
      addLog(`Git diff error: ${err instanceof Error ? err.message : String(err)}`);
      set({ loadingDiff: false });
    }
  },

  fetchLog: async (repoPath) => {
    set({ loadingCommits: true });
    try {
      const res = await apiClient.call("git.log", { repoPath, maxCount: 50 });
      set({ commits: res.commits, loadingCommits: false });
    } catch (err) {
      const addLog = useAppStore.getState().addLog;
      addLog(`Git log error: ${err instanceof Error ? err.message : String(err)}`);
      set({ loadingCommits: false });
    }
  },

  clearDiff: () => set({ currentDiff: null }),

  toggleCommitExpand: async (repoPath, hash) => {
    const { expandedCommits, commitFiles } = get();
    const next = new Set(expandedCommits);

    if (next.has(hash)) {
      next.delete(hash);
      set({ expandedCommits: next });
      return;
    }

    next.add(hash);
    set({ expandedCommits: next });

    if (!commitFiles[hash]) {
      const loading = new Set(get().loadingCommitFiles);
      loading.add(hash);
      set({ loadingCommitFiles: loading });

      try {
        const res = await apiClient.call("git.commitFiles", { repoPath, hash });
        set({ commitFiles: { ...get().commitFiles, [hash]: res.files } });
      } catch (err) {
        const addLog = useAppStore.getState().addLog;
        addLog(`Git commitFiles error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        const loading = new Set(get().loadingCommitFiles);
        loading.delete(hash);
        set({ loadingCommitFiles: loading });
      }
    }
  },

  fetchCommitFileDiff: async (repoPath, hash, filePath) => {
    const addLog = useAppStore.getState().addLog;
    addLog(`Git commit diff: ${hash.slice(0, 7)} ${filePath}`);
    set({ loadingDiff: true });
    try {
      const res = await apiClient.call("git.commitFileDiff", { repoPath, hash, filePath });
      set({ currentDiff: res, loadingDiff: false });
    } catch (err) {
      addLog(`Git commitFileDiff error: ${err instanceof Error ? err.message : String(err)}`);
      set({ loadingDiff: false });
    }
  },

  fetchBranches: async (repoPath) => {
    set({ loadingBranches: true });
    try {
      const res = await apiClient.call("git.branches", { repoPath });
      set({ branches: res.branches, loadingBranches: false });
    } catch (err) {
      const addLog = useAppStore.getState().addLog;
      addLog(`Git branches error: ${err instanceof Error ? err.message : String(err)}`);
      set({ loadingBranches: false });
    }
  },

  checkout: async (repoPath, branch) => {
    const addLog = useAppStore.getState().addLog;
    set({ loadingAction: "checkout" });
    try {
      await apiClient.call("git.checkout", { repoPath, branch });
      addLog(`Checked out: ${branch}`);
      await get().refresh(repoPath);
    } catch (err) {
      addLog(`Git checkout error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ loadingAction: null });
    }
  },

  stageFiles: async (repoPath, paths) => {
    const addLog = useAppStore.getState().addLog;
    set({ loadingAction: "stage" });
    try {
      await apiClient.call("git.add", { repoPath, paths });
      addLog(`Staged: ${paths.join(", ")}`);
      await get().refresh(repoPath);
    } catch (err) {
      addLog(`Git add error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ loadingAction: null });
    }
  },

  unstageFiles: async (repoPath, paths) => {
    const addLog = useAppStore.getState().addLog;
    set({ loadingAction: "unstage" });
    try {
      await apiClient.call("git.reset", { repoPath, paths });
      addLog(`Unstaged: ${paths.join(", ")}`);
      await get().refresh(repoPath);
    } catch (err) {
      addLog(`Git reset error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ loadingAction: null });
    }
  },

  commit: async (repoPath, message) => {
    const addLog = useAppStore.getState().addLog;
    set({ loadingAction: "commit" });
    try {
      const res = await apiClient.call("git.commit", { repoPath, message });
      addLog(`Committed: ${res.shortHash}`);
      await get().refresh(repoPath);
    } catch (err) {
      addLog(`Git commit error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ loadingAction: null });
    }
  },

  push: async (repoPath) => {
    const addLog = useAppStore.getState().addLog;
    set({ loadingAction: "push" });
    try {
      await apiClient.call("git.push", { repoPath });
      addLog("Pushed successfully");
      await get().refresh(repoPath);
    } catch (err) {
      addLog(`Git push error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ loadingAction: null });
    }
  },

  pull: async (repoPath) => {
    const addLog = useAppStore.getState().addLog;
    set({ loadingAction: "pull" });
    try {
      await apiClient.call("git.pull", { repoPath });
      addLog("Pulled successfully");
      await get().refresh(repoPath);
    } catch (err) {
      addLog(`Git pull error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      set({ loadingAction: null });
    }
  },

  fetchWorktrees: async (repoPath) => {
    try {
      const res = await apiClient.call("git.worktreeList", { repoPath });
      set({ worktrees: res.worktrees });
    } catch (err) {
      const addLog = useAppStore.getState().addLog;
      addLog(`Git worktreeList error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
}));
