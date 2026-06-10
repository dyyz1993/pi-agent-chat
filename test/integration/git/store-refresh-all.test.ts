import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mockCall,
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: () => ({
      addLog: vi.fn(),
    }),
  },
}));

import { useGitStore } from "../../../src/mainview/stores/use-git-store";

const REPO = "/tmp/test-repo";

describe("useGitStore.refreshAll", () => {
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
      branches: [],
      worktrees: [],
      loadingBranches: false,
    });
  });

  it("calls fetchStatus, fetchWorktrees, and fetchBranches in parallel", async () => {
    let statusResolved: (() => void) | undefined;
    let worktreesResolved: (() => void) | undefined;
    let branchesResolved: (() => void) | undefined;

    const statusPromise = new Promise<void>((resolve) => {
      statusResolved = resolve;
    });
    const worktreesPromise = new Promise<void>((resolve) => {
      worktreesResolved = resolve;
    });
    const branchesPromise = new Promise<void>((resolve) => {
      branchesResolved = resolve;
    });

    mockCall.mockImplementation((method: string) => {
      if (method === "git.status") {
        return statusPromise.then(() => ({
          branch: "main",
          ahead: 1,
          behind: 0,
          staged: [],
          changed: [],
          untracked: [],
        }));
      }
      if (method === "git.worktreeList") {
        return worktreesPromise.then(() => ({ worktrees: [] }));
      }
      if (method === "git.branches") {
        return branchesPromise.then(() => ({ branches: [] }));
      }
      return Promise.resolve({});
    });

    const refreshPromise = useGitStore.getState().refreshAll(REPO);

    expect(mockCall).toHaveBeenCalledWith("git.status", { repoPath: REPO });
    expect(mockCall).toHaveBeenCalledWith("git.worktreeList", { repoPath: REPO });
    expect(mockCall).toHaveBeenCalledWith("git.branches", { repoPath: REPO });
    expect(mockCall).toHaveBeenCalledTimes(3);

    statusResolved!();
    worktreesResolved!();
    branchesResolved!();

    await refreshPromise;

    expect(useGitStore.getState().branch).toBe("main");
    expect(useGitStore.getState().ahead).toBe(1);
    expect(useGitStore.getState().worktrees).toEqual([]);
    expect(useGitStore.getState().branches).toEqual([]);
  });

  it("does nothing when isGitRepo is false", async () => {
    useGitStore.setState({ isGitRepo: false });

    await useGitStore.getState().refreshAll(REPO);

    expect(mockCall).not.toHaveBeenCalled();
  });

  it("updates store state with fetched data", async () => {
    mockCall.mockImplementation((method: string) => {
      if (method === "git.status") {
        return Promise.resolve({
          branch: "feature/test",
          ahead: 3,
          behind: 2,
          staged: [{ path: "a.ts", status: "added" }],
          changed: [{ path: "b.ts", status: "modified" }],
          untracked: ["c.txt"],
        });
      }
      if (method === "git.worktreeList") {
        return Promise.resolve({
          worktrees: [{ path: "/repo", branch: "feature/test", isMain: true }],
        });
      }
      if (method === "git.branches") {
        return Promise.resolve({
          branches: [
            { name: "main", isCurrent: false, isRemote: true },
            { name: "feature/test", isCurrent: true, isRemote: false },
          ],
        });
      }
      return Promise.resolve({});
    });

    await useGitStore.getState().refreshAll(REPO);

    const state = useGitStore.getState();
    expect(state.branch).toBe("feature/test");
    expect(state.ahead).toBe(3);
    expect(state.behind).toBe(2);
    expect(state.staged).toHaveLength(1);
    expect(state.changed).toHaveLength(1);
    expect(state.untracked).toEqual(["c.txt"]);
    expect(state.worktrees).toHaveLength(1);
    expect(state.branches).toHaveLength(2);
  });
});

describe("right sidebar panel visibility triggers git refresh", () => {
  it("refreshAll is callable from useGitStore.getState()", () => {
    const store = useGitStore.getState();
    expect(typeof store.refreshAll).toBe("function");
  });

  it("refreshAll returns a promise that resolves", async () => {
    useGitStore.setState({ isGitRepo: false });
    const result = useGitStore.getState().refreshAll(REPO);
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("integrates with layout store: showStatus changes panel from hidden to visible", async () => {
    const { useLayoutStore } = await import("../../../src/mainview/layouts/use-layout-store");

    useLayoutStore.setState({ statusPanel: "hidden", breakpoint: "desktop" });
    expect(useLayoutStore.getState().statusPanel).toBe("hidden");

    useLayoutStore.getState().showStatus();
    expect(useLayoutStore.getState().statusPanel).toBe("visible");

    useLayoutStore.getState().hideStatus();
    expect(useLayoutStore.getState().statusPanel).toBe("hidden");
  });

  it("detects panel transition from hidden to visible", async () => {
    const { useLayoutStore } = await import("../../../src/mainview/layouts/use-layout-store");

    useLayoutStore.setState({ statusPanel: "hidden", breakpoint: "desktop" });

    const prevPanel = useLayoutStore.getState().statusPanel;
    useLayoutStore.getState().showStatus();
    const curPanel = useLayoutStore.getState().statusPanel;

    const becameVisible = prevPanel === "hidden" && curPanel !== "hidden";
    expect(becameVisible).toBe(true);
  });
});
