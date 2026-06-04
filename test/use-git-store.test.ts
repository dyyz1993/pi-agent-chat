import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCall, mockAddLog } = vi.hoisted(() => ({
  mockCall: vi.fn(),
  mockAddLog: vi.fn(),
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: mockAddLog }) },
}));

import { useGitStore } from "../src/mainview/stores/use-git-store";

const REPO = "/tmp/repo";

describe("useGitStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitStore.setState({
      isGitRepo: true,
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
    });
  });

  it("has correct initial state", () => {
    const s = useGitStore.getState();
    expect(s.branch).toBe("");
    expect(s.staged).toEqual([]);
    expect(s.loadingAction).toBeNull();
  });

  it("fetchStatus success sets branch/ahead/behind/staged/changed/untracked", async () => {
    mockCall.mockResolvedValueOnce({
      branch: "main",
      ahead: 2,
      behind: 1,
      staged: [{ path: "a.ts", status: "modified" }],
      changed: [{ path: "b.ts", status: "added" }],
      untracked: ["c.ts"],
    });
    await useGitStore.getState().fetchStatus(REPO);
    const s = useGitStore.getState();
    expect(s.branch).toBe("main");
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.staged).toEqual([{ path: "a.ts", status: "modified" }]);
    expect(s.changed).toEqual([{ path: "b.ts", status: "added" }]);
    expect(s.untracked).toEqual(["c.ts"]);
  });

  it("fetchStatus failure resets to empty", async () => {
    mockCall.mockRejectedValueOnce(new Error("fail"));
    useGitStore.setState({ branch: "main", ahead: 5 });
    await useGitStore.getState().fetchStatus(REPO);
    const s = useGitStore.getState();
    expect(s.branch).toBe("");
    expect(s.ahead).toBe(0);
    expect(s.behind).toBe(0);
    expect(s.staged).toEqual([]);
    expect(s.changed).toEqual([]);
    expect(s.untracked).toEqual([]);
  });

  it("fetchDiff success sets currentDiff and loadingDiff=false", async () => {
    const diff = { filePath: "a.ts", diff: "+hello", oldContent: "", newContent: "hello" };
    mockCall.mockResolvedValueOnce(diff);
    await useGitStore.getState().fetchDiff(REPO, "a.ts");
    const s = useGitStore.getState();
    expect(s.currentDiff).toEqual(diff);
    expect(s.loadingDiff).toBe(false);
  });

  it("fetchDiff failure sets loadingDiff=false", async () => {
    mockCall.mockRejectedValueOnce(new Error("fail"));
    await useGitStore.getState().fetchDiff(REPO, "a.ts");
    expect(useGitStore.getState().loadingDiff).toBe(false);
  });

  it("fetchLog success sets commits", async () => {
    const commits = [
      { hash: "abc123", shortHash: "abc1234", message: "init", author: "me", date: "2024-01-01" },
    ];
    mockCall.mockResolvedValueOnce({ commits });
    await useGitStore.getState().fetchLog(REPO);
    expect(useGitStore.getState().commits).toEqual(commits);
  });

  it("clearDiff sets currentDiff to null", () => {
    useGitStore.setState({
      currentDiff: { filePath: "x", diff: "d", oldContent: "", newContent: "" },
    });
    useGitStore.getState().clearDiff();
    expect(useGitStore.getState().currentDiff).toBeNull();
  });

  it("toggleCommitExpand new hash adds to expandedCommits", async () => {
    mockCall.mockResolvedValueOnce({ files: [] });
    await useGitStore.getState().toggleCommitExpand(REPO, "hash1");
    expect(useGitStore.getState().expandedCommits.has("hash1")).toBe(true);
  });

  it("toggleCommitExpand same hash removes from expandedCommits", async () => {
    useGitStore.setState({ expandedCommits: new Set(["hash1"]) });
    await useGitStore.getState().toggleCommitExpand(REPO, "hash1");
    expect(useGitStore.getState().expandedCommits.has("hash1")).toBe(false);
  });

  it("fetchBranches success sets branches", async () => {
    const branches = [
      { name: "main", isCurrent: true, isRemote: false },
      { name: "dev", isCurrent: false, isRemote: true },
    ];
    mockCall.mockResolvedValueOnce({ branches });
    await useGitStore.getState().fetchBranches(REPO);
    expect(useGitStore.getState().branches).toEqual(branches);
  });

  it("checkout success sets loadingAction then null", async () => {
    mockCall.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      branch: "dev",
      ahead: 0,
      behind: 0,
      staged: [],
      changed: [],
      untracked: [],
    });
    const promise = useGitStore.getState().checkout(REPO, "dev");
    expect(useGitStore.getState().loadingAction).toBe("checkout");
    await promise;
    expect(useGitStore.getState().loadingAction).toBeNull();
  });

  it("stageFiles success calls git.add and refresh", async () => {
    mockCall.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [{ path: "a.ts", status: "modified" }],
      changed: [],
      untracked: [],
    });
    await useGitStore.getState().stageFiles(REPO, ["a.ts"]);
    expect(mockCall).toHaveBeenCalledWith("git.add", { repoPath: REPO, paths: ["a.ts"] });
    expect(useGitStore.getState().loadingAction).toBeNull();
  });

  it("commit success calls git.commit and refresh", async () => {
    mockCall.mockResolvedValueOnce({ shortHash: "abc1234" }).mockResolvedValueOnce({
      branch: "main",
      ahead: 1,
      behind: 0,
      staged: [],
      changed: [],
      untracked: [],
    });
    await useGitStore.getState().commit(REPO, "msg");
    expect(mockCall).toHaveBeenCalledWith("git.commit", {
      repoPath: REPO,
      message: "msg",
      noVerify: true,
    });
    expect(useGitStore.getState().loadingAction).toBeNull();
  });

  it("fetchWorktrees success sets worktrees", async () => {
    const worktrees = [{ path: "/wt", branch: "feat", isMain: false }];
    mockCall.mockResolvedValueOnce({ worktrees });
    await useGitStore.getState().fetchWorktrees(REPO);
    expect(useGitStore.getState().worktrees).toEqual(worktrees);
  });

  it("addWorktree success appends new worktree", async () => {
    const newWt = { path: "/wt2", branch: "feat2", isMain: false };
    mockCall
      .mockResolvedValueOnce({ worktree: newWt })
      .mockResolvedValueOnce({ worktrees: [newWt] });
    const result = await useGitStore.getState().addWorktree(REPO, "feat2");
    expect(result).toEqual(newWt);
    expect(useGitStore.getState().worktrees).toContainEqual(newWt);
  });

  it("addWorktree failure throws error", async () => {
    mockCall.mockRejectedValueOnce(new Error("wt fail"));
    await expect(useGitStore.getState().addWorktree(REPO, "bad")).rejects.toThrow("wt fail");
  });
});
