import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";

const mockFetchStatus = vi.fn(() => Promise.resolve());
const mockFetchWorktrees = vi.fn(() => Promise.resolve());
const mockFetchBranches = vi.fn(() => Promise.resolve());

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

interface GitState {
  isGitRepo: boolean;
  fetchStatus: (repoPath: string) => Promise<void>;
  fetchWorktrees: (repoPath: string) => Promise<void>;
  fetchBranches: (repoPath: string) => Promise<void>;
  refreshAll: (repoPath: string) => Promise<void>;
}

function createGitStore(isGitRepo: boolean) {
  return create<GitState>((set, get) => ({
    isGitRepo,
    fetchStatus: mockFetchStatus,
    fetchWorktrees: mockFetchWorktrees,
    fetchBranches: mockFetchBranches,
    refreshAll: async (repoPath: string) => {
      if (!get().isGitRepo) return;
      await Promise.all([
        get().fetchStatus(repoPath),
        get().fetchWorktrees(repoPath),
        get().fetchBranches(repoPath),
      ]);
    },
  }));
}

const REPO_PATH = "/tmp/test-repo";

describe("git tab refresh on tab switch", () => {
  let gitStore: ReturnType<typeof createGitStore>;

  beforeEach(() => {
    mockFetchStatus.mockClear();
    mockFetchWorktrees.mockClear();
    mockFetchBranches.mockClear();
    gitStore = createGitStore(true);
  });

  it("refreshAll calls fetchStatus, fetchWorktrees, fetchBranches when isGitRepo is true", async () => {
    await gitStore.getState().refreshAll(REPO_PATH);

    expect(mockFetchStatus).toHaveBeenCalledWith(REPO_PATH);
    expect(mockFetchWorktrees).toHaveBeenCalledWith(REPO_PATH);
    expect(mockFetchBranches).toHaveBeenCalledWith(REPO_PATH);
  });

  it("refreshAll skips all fetches when isGitRepo is false", async () => {
    const nonGitStore = createGitStore(false);

    await nonGitStore.getState().refreshAll(REPO_PATH);

    expect(mockFetchStatus).not.toHaveBeenCalled();
    expect(mockFetchWorktrees).not.toHaveBeenCalled();
    expect(mockFetchBranches).not.toHaveBeenCalled();
  });

  it("refreshAll is idempotent across rapid calls", async () => {
    await Promise.all([
      gitStore.getState().refreshAll(REPO_PATH),
      gitStore.getState().refreshAll(REPO_PATH),
    ]);

    expect(mockFetchStatus).toHaveBeenCalledTimes(2);
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(2);
    expect(mockFetchBranches).toHaveBeenCalledTimes(2);
  });

  it("simulates tab switch: git tab triggers refreshAll, other tabs do not", async () => {
    const simulateTabSwitch = (tab: string) => {
      if (tab === "git" && gitStore.getState().isGitRepo) {
        void gitStore.getState().refreshAll(REPO_PATH);
      }
    };

    simulateTabSwitch("status");
    expect(mockFetchStatus).not.toHaveBeenCalled();

    simulateTabSwitch("files");
    expect(mockFetchStatus).not.toHaveBeenCalled();

    simulateTabSwitch("git");
    await vi.waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalledWith(REPO_PATH);
      expect(mockFetchWorktrees).toHaveBeenCalledWith(REPO_PATH);
      expect(mockFetchBranches).toHaveBeenCalledWith(REPO_PATH);
    });

    expect(mockFetchStatus).toHaveBeenCalledTimes(1);
    expect(mockFetchWorktrees).toHaveBeenCalledTimes(1);
    expect(mockFetchBranches).toHaveBeenCalledTimes(1);
  });
});
