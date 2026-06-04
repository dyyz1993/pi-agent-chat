import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCall, mockAddLog } = vi.hoisted(() => {
  const mockCall = vi.fn();
  const mockAddLog = vi.fn();
  return { mockCall, mockAddLog };
});

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: () => ({ addLog: mockAddLog }),
  },
}));

import { useGitStore } from "../src/mainview/stores/use-git-store";

const REPO_PATH = "/test/repo";

const MOCK_WORKTREE = {
  path: "/test/repo-feature",
  branch: "feature",
  isMain: false,
};

const MOCK_FETCHED_WORKTREES = [
  { path: "/test/repo", branch: "main", isMain: true },
  { path: "/test/repo-feature", branch: "feature", isMain: false },
];

describe("addWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({
      isGitRepo: true,
      worktrees: [{ path: "/test/repo", branch: "main", isMain: true }],
    });
    mockCall.mockReset();
  });

  it("should call fetchWorktrees after successful creation to get authoritative list", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "git.worktreeAdd") {
        return Promise.resolve({ worktree: MOCK_WORKTREE });
      }
      if (method === "git.worktreeList") {
        return Promise.resolve({ worktrees: MOCK_FETCHED_WORKTREES });
      }
      return Promise.resolve({});
    });

    await useGitStore.getState().addWorktree(REPO_PATH, "feature", "main");

    expect(mockCall).toHaveBeenCalledWith("git.worktreeAdd", {
      repoPath: REPO_PATH,
      branch: "feature",
      sourceBranch: "main",
    });
    expect(mockCall).toHaveBeenCalledWith("git.worktreeList", {
      repoPath: REPO_PATH,
    });

    expect(useGitStore.getState().worktrees).toEqual(MOCK_FETCHED_WORKTREES);
  });

  it("should NOT call fetchWorktrees if worktreeAdd fails", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "git.worktreeAdd") {
        return Promise.reject(new Error("worktree add failed"));
      }
      return Promise.resolve({});
    });

    await expect(useGitStore.getState().addWorktree(REPO_PATH, "feature", "main")).rejects.toThrow(
      "worktree add failed",
    );

    expect(mockCall).not.toHaveBeenCalledWith("git.worktreeList", expect.anything());
  });

  it("should still return the worktree from the RPC response", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "git.worktreeAdd") {
        return Promise.resolve({ worktree: MOCK_WORKTREE });
      }
      if (method === "git.worktreeList") {
        return Promise.resolve({ worktrees: MOCK_FETCHED_WORKTREES });
      }
      return Promise.resolve({});
    });

    const result = await useGitStore.getState().addWorktree(REPO_PATH, "feature", "main");

    expect(result).toEqual(MOCK_WORKTREE);
  });
});
