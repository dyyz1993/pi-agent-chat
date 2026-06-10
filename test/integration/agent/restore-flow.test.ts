/**
 * @vitest-environment node
 *
 * Tests for runRestoreFlow — the extracted app restore logic.
 *
 * Key invariant under test: `setRestoring(false)` must be called AFTER
 * `loadSessionsForProject` resolves and `setActiveSession` is called,
 * never before. Otherwise the UI flashes an empty state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runRestoreFlow, type RestoreFlowDeps } from "../../../src/mainview/lib/restore-flow";
import type { SessionMeta } from "../../../src/shared/modules/project";

function makeTrace() {
  return {
    id: "test-trace",
    mark: vi.fn(),
    done: vi.fn(),
    error: vi.fn(),
  };
}

function makeMinimalDeps(overrides: Partial<RestoreFlowDeps> = {}): RestoreFlowDeps {
  return {
    isCancelled: () => false,
    setRestoring: vi.fn(),
    addLog: vi.fn(),
    callApi: vi.fn().mockResolvedValue({ tabs: [], activeTabId: null }),
    loadSessionsForProject: vi.fn().mockResolvedValue([]),
    addProjectTab: vi.fn(),
    setActiveProject: vi.fn(),
    setActiveSession: vi.fn(),
    createNewSession: vi.fn().mockResolvedValue(undefined),
    getProjectTabs: vi.fn().mockReturnValue([]),
    getLastActiveSessionByProject: vi.fn().mockReturnValue({}),
    loadSessionMessages: vi.fn(),
    log: { info: vi.fn() },
    trace: makeTrace(),
    ...overrides,
  };
}

function makeSession(sid: string, path = "/proj"): SessionMeta {
  return {
    sessionId: sid,
    name: sid,
    sessionPath: `${path}/.sessions/${sid}`,
    projectPath: path,
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: 0,
    updatedAt: 0,
    status: "idle",
  };
}

beforeEach(() => {
  // No URL session by default
  vi.stubGlobal("window", { location: { search: "" } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runRestoreFlow — setRestoring timing (anti-flicker)", () => {
  it("saved-tabs path: setRestoring(false) AFTER loadSessionsForProject resolves", async () => {
    let resolveLoad!: (v: SessionMeta[]) => void;
    const loadPromise = new Promise<SessionMeta[]>((r) => {
      resolveLoad = r;
    });

    const setRestoring = vi.fn();
    const setActiveSession = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      setActiveSession,
      callApi: vi.fn().mockResolvedValue({
        tabs: [{ id: "tab-1", name: "Proj", path: "/proj" }],
        activeTabId: "tab-1",
      }),
      loadSessionsForProject: vi.fn().mockReturnValue(loadPromise),
    });

    // Kick off — don't await yet
    const promise = runRestoreFlow(deps);

    // While loadSessionsForProject is pending, restoring must NOT be released
    await Promise.resolve(); // flush microtasks
    expect(setRestoring).not.toHaveBeenCalledWith(false);
    expect(setActiveSession).not.toHaveBeenCalled();

    // Now resolve
    resolveLoad([makeSession("s1", "/proj")]);
    await promise;

    // After resolve: setActiveSession called first, then setRestoring(false)
    expect(setActiveSession).toHaveBeenCalledWith("s1");
    expect(setRestoring).toHaveBeenCalledWith(false);

    // Verify ordering: setActiveSession before setRestoring(false)
    const sessionCallIdx = setActiveSession.mock.invocationCallOrder[0];
    const restoringCallIdx = setRestoring.mock.invocationCallOrder.find(
      (order, i) => setRestoring.mock.calls[i][0] === false,
    );
    expect(restoringCallIdx).toBeDefined();
    expect(sessionCallIdx).toBeLessThan(restoringCallIdx!);
  });

  it("recent-projects path: setRestoring(false) AFTER loadSessionsForProject resolves", async () => {
    let resolveLoad!: (v: SessionMeta[]) => void;
    const loadPromise = new Promise<SessionMeta[]>((r) => {
      resolveLoad = r;
    });

    const setRestoring = vi.fn();
    const setActiveSession = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      setActiveSession,
      // No saved tabs → falls through to recent projects
      callApi: vi.fn().mockResolvedValue({
        projects: [{ path: "/proj", name: "Proj", sessionCount: 1 }],
      }),
      loadSessionsForProject: vi.fn().mockReturnValue(loadPromise),
    });

    const promise = runRestoreFlow(deps);

    await Promise.resolve();
    expect(setRestoring).not.toHaveBeenCalledWith(false);
    expect(setActiveSession).not.toHaveBeenCalled();

    resolveLoad([makeSession("s1", "/proj")]);
    await promise;

    expect(setActiveSession).toHaveBeenCalledWith("s1");
    expect(setRestoring).toHaveBeenCalledWith(false);

    const sessionCallIdx = setActiveSession.mock.invocationCallOrder[0];
    const restoringFalseCall = setRestoring.mock.invocationCallOrder.find(
      (order, i) => setRestoring.mock.calls[i][0] === false,
    );
    expect(restoringFalseCall).toBeDefined();
    expect(sessionCallIdx).toBeLessThan(restoringFalseCall!);
  });

  it("URL session path: setRestoring(false) at the very end after loadSessionMessages", async () => {
    const setRestoring = vi.fn();
    const loadSessionMessages = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      loadSessionMessages,
      callApi: vi.fn()
        .mockResolvedValueOnce({
          session: {
            sessionPath: "/proj/.sessions/s1",
            projectPath: "/proj",
            name: "S1",
          },
        })
        .mockResolvedValueOnce({ status: "ok" }),
      loadSessionsForProject: vi.fn().mockResolvedValue([makeSession("s1", "/proj")]),
    });

    vi.stubGlobal("window", { location: { search: "?session=s1" } });

    await runRestoreFlow(deps);

    // loadSessionMessages must be called before setRestoring(false)
    expect(loadSessionMessages).toHaveBeenCalled();
    expect(setRestoring).toHaveBeenCalledWith(false);

    const loadMsgIdx = loadSessionMessages.mock.invocationCallOrder[0];
    const restoringIdx = setRestoring.mock.invocationCallOrder.find(
      (order, i) => setRestoring.mock.calls[i][0] === false,
    );
    expect(restoringIdx).toBeDefined();
    expect(loadMsgIdx).toBeLessThan(restoringIdx!);
  });
});

describe("runRestoreFlow — error and edge cases", () => {
  it("releases restoring on unexpected error", async () => {
    const setRestoring = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      callApi: vi.fn().mockRejectedValue(new Error("network down")),
    });

    await runRestoreFlow(deps);

    expect(setRestoring).toHaveBeenCalledWith(false);
  });

  it("does NOT release restoring when cancelled", async () => {
    const setRestoring = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      isCancelled: () => true,
    });

    await runRestoreFlow(deps);

    expect(setRestoring).not.toHaveBeenCalledWith(false);
  });

  it("releases restoring when no projects exist", async () => {
    const setRestoring = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      callApi: vi.fn().mockResolvedValue({ projects: [] }),
    });

    await runRestoreFlow(deps);

    expect(setRestoring).toHaveBeenCalledWith(false);
  });

  it("releases restoring when session not found (URL path)", async () => {
    const setRestoring = vi.fn();
    const deps = makeMinimalDeps({
      setRestoring,
      callApi: vi.fn().mockResolvedValue({ session: null }),
    });

    vi.stubGlobal("window", { location: { search: "?session=nonexistent" } });

    await runRestoreFlow(deps);

    expect(setRestoring).toHaveBeenCalledWith(false);
  });

  it("creates new session when project has zero sessions (saved-tabs path)", async () => {
    const createNewSession = vi.fn().mockResolvedValue(undefined);
    const setRestoring = vi.fn();
    const deps = makeMinimalDeps({
      createNewSession,
      setRestoring,
      callApi: vi.fn().mockResolvedValue({
        tabs: [{ id: "tab-1", name: "Proj", path: "/proj" }],
        activeTabId: "tab-1",
      }),
      loadSessionsForProject: vi.fn().mockResolvedValue([]),
    });

    await runRestoreFlow(deps);

    expect(createNewSession).toHaveBeenCalled();
    expect(setRestoring).toHaveBeenCalledWith(false);
  });
});

describe("runRestoreFlow — tab restoration logic", () => {
  it("does not add duplicate tabs that already exist", async () => {
    const addProjectTab = vi.fn();
    const deps = makeMinimalDeps({
      addProjectTab,
      getProjectTabs: vi.fn().mockReturnValue([
        { id: "tab-1", name: "Existing", path: "/proj" },
      ]),
      callApi: vi.fn().mockResolvedValue({
        tabs: [
          { id: "tab-1", name: "Existing", path: "/proj" },
          { id: "tab-2", name: "New", path: "/proj2" },
        ],
        activeTabId: "tab-1",
      }),
      loadSessionsForProject: vi.fn().mockResolvedValue([makeSession("s1", "/proj")]),
    });

    await runRestoreFlow(deps);

    // Only tab-2 should be added (tab-1 already exists)
    expect(addProjectTab).toHaveBeenCalledTimes(1);
    expect(addProjectTab).toHaveBeenCalledWith({
      id: "tab-2",
      name: "New",
      path: "/proj2",
    });
  });

  it("selects last active session when available", async () => {
    const setActiveSession = vi.fn();
    const deps = makeMinimalDeps({
      setActiveSession,
      callApi: vi.fn().mockResolvedValue({
        tabs: [{ id: "tab-1", name: "Proj", path: "/proj" }],
        activeTabId: "tab-1",
      }),
      loadSessionsForProject: vi.fn().mockResolvedValue([
        makeSession("s1", "/proj"),
        makeSession("s2", "/proj"),
      ]),
      getLastActiveSessionByProject: vi.fn().mockReturnValue({ "/proj": "s2" }),
    });

    await runRestoreFlow(deps);

    expect(setActiveSession).toHaveBeenCalledWith("s2");
  });

  it("falls back to first session when last active is gone", async () => {
    const setActiveSession = vi.fn();
    const deps = makeMinimalDeps({
      setActiveSession,
      callApi: vi.fn().mockResolvedValue({
        tabs: [{ id: "tab-1", name: "Proj", path: "/proj" }],
        activeTabId: "tab-1",
      }),
      loadSessionsForProject: vi.fn().mockResolvedValue([
        makeSession("s1", "/proj"),
      ]),
      getLastActiveSessionByProject: vi.fn().mockReturnValue({ "/proj": "gone-sid" }),
    });

    await runRestoreFlow(deps);

    expect(setActiveSession).toHaveBeenCalledWith("s1");
  });
});
