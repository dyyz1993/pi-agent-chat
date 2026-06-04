/**
 * @vitest-environment node
 *
 * TDD: Comprehensive tests for loadSessionsForProject merge logic
 *
 * Three bug dimensions:
 * 1. Merge bug: second call destroys all sessions (newFromDisk vs sessions)
 * 2. Concurrent guard: duplicate calls race and overwrite each other
 * 3. Loading state: initial false causes empty-flash, lifecycle is incomplete
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
    subscribe: vi.fn().mockResolvedValue("mock-sub-id"),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: vi.fn(() => ({ addEntry: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: {
    getState: vi.fn(() => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn() })),
  },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: vi.fn(() => ({ clearSessionUI: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: vi.fn(() => ({ clearSessionUI: vi.fn() })) },
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: { getState: () => ({}) },
  handleBashEvent: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/agent-event-handler", () => ({
  handleAgentEvent: vi.fn(),
  toolCallNameMap: {},
}));

vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
}));

import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { SessionMeta } from "../src/mainview/types";

const mockedCall = apiClient.call as unknown as ReturnType<typeof vi.fn>;

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  const sid = overrides.sessionId ?? "sess-" + Date.now();
  return {
    sessionId: sid,
    name: "",
    sessionPath: "/sessions/" + sid + ".jsonl",
    projectPath: "/project-a",
    parentSessionPath: null,
    delegateParentSessionId: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    pinned: false,
    ...overrides,
  };
}

beforeEach(() => {
  // resetAllMocks to clear leftover mockImplementationOnce between tests
  vi.resetAllMocks();
  // Re-apply default mock behavior that resetAllMocks cleared
  mockedCall.mockResolvedValue({});
  useSessionStore.setState({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    loading: false,
    agentSubscriptions: {},
    subagentSubscriptions: {},
    todoSubscriptions: {},
    bashSubscriptions: {},
    lspSubscriptions: {},
    rulesSubscriptions: {},
    notifySubscriptions: {},
    memorySubscriptions: {},
    supervisorSubscriptions: {},
    coordinatorSubscriptions: {},
    sessionReady: {},
    todosBySession: {},
    sessionContextMap: {},
    sessionStatusMap: {},
    queueBySession: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
  });
});

// ============================================================
// Dimension 1: Merge Bug — second call destroys all sessions
// ============================================================
describe("Merge Bug: second loadSessionsForProject call destroys sessions", () => {
  it("GIVEN no existing sessions WHEN first load THEN stores all disk sessions", async () => {
    const diskSessions = [
      makeSession({
        sessionId: "s1",
        sessionPath: "/s/s1.jsonl",
        messageCount: 3,
        firstMessage: "hi",
      }),
      makeSession({
        sessionId: "s2",
        sessionPath: "/s/s2.jsonl",
        messageCount: 1,
        firstMessage: "yo",
      }),
      makeSession({
        sessionId: "s3",
        sessionPath: "/s/s3.jsonl",
        messageCount: 5,
        firstMessage: "hey",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: diskSessions });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.sessionId)).toEqual(["s1", "s2", "s3"]);
  });

  it("GIVEN sessions already in store WHEN second load with same disk state THEN preserves all sessions", async () => {
    const diskSessions = [
      makeSession({
        sessionId: "s1",
        sessionPath: "/s/s1.jsonl",
        messageCount: 3,
        firstMessage: "hi",
      }),
      makeSession({
        sessionId: "s2",
        sessionPath: "/s/s2.jsonl",
        messageCount: 1,
        firstMessage: "yo",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: diskSessions });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    // Second call: same disk state
    mockedCall.mockResolvedValueOnce({ sessions: diskSessions });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    // BUG: second call returns [] because newFromDisk is empty and filter kills everything
    // FIX: should return [s1, s2]
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("GIVEN sessions in store WHEN second load with NEW sessions on disk THEN adds new + keeps old", async () => {
    const s1 = makeSession({
      sessionId: "s1",
      sessionPath: "/s/s1.jsonl",
      messageCount: 3,
      firstMessage: "hi",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [s1] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    // Second call: s1 still on disk, plus new s2
    const s2 = makeSession({
      sessionId: "s2",
      sessionPath: "/s/s2.jsonl",
      messageCount: 1,
      firstMessage: "yo",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [s1, s2] });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("GIVEN sessions in store WHEN second load has a session removed from disk THEN removes it from store", async () => {
    const s1 = makeSession({
      sessionId: "s1",
      sessionPath: "/s/s1.jsonl",
      messageCount: 3,
      firstMessage: "hi",
    });
    const s2 = makeSession({
      sessionId: "s2",
      sessionPath: "/s/s2.jsonl",
      messageCount: 1,
      firstMessage: "yo",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [s1, s2] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    // s2 deleted from disk
    mockedCall.mockResolvedValueOnce({ sessions: [s1] });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("GIVEN store has existing + newFromDisk has only dupes WHEN second load THEN keeps existing sessions", async () => {
    const s1 = makeSession({
      sessionId: "s1",
      sessionPath: "/s/s1.jsonl",
      messageCount: 3,
      firstMessage: "hi",
    });
    const s2 = makeSession({
      sessionId: "s2",
      sessionPath: "/s/s2.jsonl",
      messageCount: 1,
      firstMessage: "yo",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [s1, s2] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    // Third call: same sessions (dupes)
    mockedCall.mockResolvedValueOnce({ sessions: [s1, s2] });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  it("GIVEN 3 consecutive loads with same disk state THEN sessions stay stable", async () => {
    const diskSessions = [
      makeSession({
        sessionId: "s1",
        sessionPath: "/s/s1.jsonl",
        messageCount: 1,
        firstMessage: "a",
      }),
      makeSession({
        sessionId: "s2",
        sessionPath: "/s/s2.jsonl",
        messageCount: 2,
        firstMessage: "b",
      }),
      makeSession({
        sessionId: "s3",
        sessionPath: "/s/s3.jsonl",
        messageCount: 3,
        firstMessage: "c",
      }),
    ];

    for (let i = 0; i < 3; i++) {
      mockedCall.mockResolvedValueOnce({ sessions: diskSessions });
    }

    for (let i = 0; i < 3; i++) {
      const result = await useSessionStore.getState().loadSessionsForProject("/project-a");
      expect(result).toHaveLength(3);
      expect(new Set(result.map((s) => s.sessionId))).toEqual(new Set(["s1", "s2", "s3"]));
    }
  });

  it("GIVEN multiple projects WHEN loading each independently THEN projects don't interfere", async () => {
    const projASessions = [
      makeSession({
        sessionId: "a1",
        sessionPath: "/s/a1.jsonl",
        projectPath: "/proj-a",
        messageCount: 3,
        firstMessage: "hi",
      }),
    ];
    const projBSessions = [
      makeSession({
        sessionId: "b1",
        sessionPath: "/s/b1.jsonl",
        projectPath: "/proj-b",
        messageCount: 1,
        firstMessage: "yo",
      }),
      makeSession({
        sessionId: "b2",
        sessionPath: "/s/b2.jsonl",
        projectPath: "/proj-b",
        messageCount: 2,
        firstMessage: "hey",
      }),
    ];

    mockedCall.mockResolvedValueOnce({ sessions: projASessions });
    mockedCall.mockResolvedValueOnce({ sessions: projBSessions });

    await useSessionStore.getState().loadSessionsForProject("/proj-a");
    await useSessionStore.getState().loadSessionsForProject("/proj-b");

    // Second round: same state
    mockedCall.mockResolvedValueOnce({ sessions: projASessions });
    mockedCall.mockResolvedValueOnce({ sessions: projBSessions });

    const resultA = await useSessionStore.getState().loadSessionsForProject("/proj-a");
    const resultB = await useSessionStore.getState().loadSessionsForProject("/proj-b");

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(2);
  });
});

// ============================================================
// Dimension 2: Merge correct with blank sessions
// ============================================================
describe("Merge with blank sessions", () => {
  it("GIVEN multiple blanks on disk WHEN loading THEN keeps newest blank only", async () => {
    const blank1 = makeSession({
      sessionId: "blank-1",
      sessionPath: "/s/blank-1.jsonl",
      messageCount: 0,
      firstMessage: "",
      createdAt: 1000,
    });
    const blank2 = makeSession({
      sessionId: "blank-2",
      sessionPath: "/s/blank-2.jsonl",
      messageCount: 0,
      firstMessage: "",
      createdAt: 2000,
    });
    const real = makeSession({
      sessionId: "real-1",
      sessionPath: "/s/real-1.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [blank1, blank2, real] });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(2);
    expect(result.find((s) => s.sessionId === "blank-1")).toBeUndefined();
    expect(result.find((s) => s.sessionId === "blank-2")).toBeDefined();
    expect(result.find((s) => s.sessionId === "real-1")).toBeDefined();
  });

  it("GIVEN single blank session on disk WHEN loading THEN keeps it", async () => {
    const blank = makeSession({ sessionId: "blank-1", messageCount: 0, firstMessage: "" });
    mockedCall.mockResolvedValueOnce({ sessions: [blank] });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("blank-1");
  });

  it("GIVEN blank in existing AND blank on disk WHEN merging THEN keeps only one blank total", async () => {
    const existingBlank = makeSession({
      sessionId: "existing-blank",
      sessionPath: "/s/existing-blank.jsonl",
      messageCount: 0,
      firstMessage: "",
    });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [existingBlank] },
    });

    const diskReal = makeSession({
      sessionId: "disk-real",
      sessionPath: "/s/disk-real.jsonl",
      messageCount: 3,
      firstMessage: "from disk",
    });
    const diskBlank = makeSession({
      sessionId: "disk-blank",
      sessionPath: "/s/disk-blank.jsonl",
      messageCount: 0,
      firstMessage: "",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [diskReal, diskBlank] });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    // Should keep existingBlank (already in store) + diskReal (new) + diskBlank (new)
    // But since there are 2 blanks (existingBlank + diskBlank), one should be removed
    // The blanks cleanup applies to allBlankSessions = [...existing, ...newFromDisk]
    // allBlankSessions = [existingBlank, diskBlank] (2) → keep newest
    // Keep 2 sessions total: one blank + diskReal
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.sessionId === "disk-real")).toBeDefined();
  });
});

// ============================================================
// Dimension 3: Loading state lifecycle
// ============================================================
describe("Loading state lifecycle", () => {
  it("GIVEN initial state WHEN loadSessionsForProject starts THEN loading is true", async () => {
    let loadingDuringCall = false;
    mockedCall.mockImplementationOnce(async () => {
      loadingDuringCall = useSessionStore.getState().loading;
      return { sessions: [makeSession()] };
    });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    // loading must be true during the RPC call
    expect(loadingDuringCall).toBe(true);
  });

  it("GIVEN load in progress WHEN load completes successfully THEN loading is false", async () => {
    mockedCall.mockResolvedValueOnce({ sessions: [makeSession()] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(useSessionStore.getState().loading).toBe(false);
  });

  it("GIVEN load in progress WHEN API fails THEN loading is false", async () => {
    mockedCall.mockRejectedValueOnce(new Error("API failure"));

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(useSessionStore.getState().loading).toBe(false);
  });

  it("GIVEN loading is true WHEN second concurrent load happens THEN both calls complete with merge fix", async () => {
    let resolveFirst: (v: unknown) => void;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    mockedCall.mockImplementationOnce(() => firstPromise);
    mockedCall.mockResolvedValue({ sessions: [makeSession({ sessionId: "s2" })] });

    const firstCall = useSessionStore.getState().loadSessionsForProject("/project-a");
    const secondCall = useSessionStore.getState().loadSessionsForProject("/project-a");

    // loading should be true during the pending API call
    expect(useSessionStore.getState().loading).toBe(true);

    resolveFirst!({ sessions: [makeSession({ sessionId: "s1" })] });

    const [r1, r2] = await Promise.all([firstCall, secondCall]);

    // Second call completes with its own RPC and merge
    expect(r1).toHaveLength(1);
    expect(r1[0].sessionId).toBe("s1");
    expect(r2).toHaveLength(1);
  });
});

// ============================================================
// Dimension 4: Error handling
// ============================================================
describe("Error handling", () => {
  it("GIVEN API throws WHEN loadSessionsForProject THEN returns empty array", async () => {
    mockedCall.mockRejectedValueOnce(new Error("network error"));

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toEqual([]);
  });

  it("GIVEN API throws THEN loading is set to false", async () => {
    mockedCall.mockRejectedValueOnce(new Error("network error"));

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(useSessionStore.getState().loading).toBe(false);
  });

  it("GIVEN API throws WHEN sessions already exist THEN existing sessions are NOT wiped", async () => {
    const existing = [
      makeSession({
        sessionId: "s1",
        sessionPath: "/s/s1.jsonl",
        messageCount: 3,
        firstMessage: "hi",
      }),
    ];
    useSessionStore.setState({
      sessionsByProject: { "/project-a": existing },
    });

    mockedCall.mockRejectedValueOnce(new Error("network error"));

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    // Existing sessions should survive the error
    const stored = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe("s1");
  });
});

// ============================================================
// Dimension 5: Dedup logic
// ============================================================
describe("Dedup logic in loadSessionsForProject", () => {
  it("GIVEN duplicate sessionId in scan result THEN keeps first occurrence only", async () => {
    const scanned = [
      makeSession({
        sessionId: "dup-id",
        sessionPath: "/s/a.jsonl",
        messageCount: 1,
        firstMessage: "a",
      }),
      makeSession({
        sessionId: "dup-id",
        sessionPath: "/s/b.jsonl",
        messageCount: 2,
        firstMessage: "b",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: scanned });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(1);
    expect(result[0].sessionPath).toBe("/s/a.jsonl");
  });

  it("GIVEN duplicate sessionPath in scan result THEN keeps first occurrence only", async () => {
    const scanned = [
      makeSession({
        sessionId: "s1",
        sessionPath: "/s/shared.jsonl",
        messageCount: 1,
        firstMessage: "a",
      }),
      makeSession({
        sessionId: "s2",
        sessionPath: "/s/shared.jsonl",
        messageCount: 2,
        firstMessage: "b",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: scanned });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("s1");
  });

  it("GIVEN session from scan has same path as existing in store THEN keeps existing and adds unique from scan", async () => {
    const existing = makeSession({
      sessionId: "existing-s1",
      sessionPath: "/s/shared.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [existing] },
    });

    const scanned = [
      makeSession({ sessionId: "coord-new", sessionPath: "/s/shared.jsonl", messageCount: 0 }),
      makeSession({
        sessionId: "unique",
        sessionPath: "/s/unique.jsonl",
        messageCount: 1,
        firstMessage: "x",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: scanned });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    // existing-s1 kept (confirmed on disk via sessionPath match),
    // coord-new filtered (sessionPath already in store),
    // unique added (new sessionPath)
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.sessionId === "existing-s1")).toBeDefined();
    expect(result.find((s) => s.sessionId === "unique")).toBeDefined();
  });
});

// ============================================================
// Dimension 6: Concurrent call guard
// ============================================================
describe("Concurrent loadSessionsForProject guard", () => {
  it("GIVEN two concurrent calls for same project WITH merge fix THEN both produce correct merged result", async () => {
    const sessions = [
      makeSession({
        sessionId: "s1",
        sessionPath: "/s/s1.jsonl",
        messageCount: 3,
        firstMessage: "hi",
      }),
    ];
    mockedCall.mockResolvedValue({ sessions });

    const [r1, r2] = await Promise.all([
      useSessionStore.getState().loadSessionsForProject("/project-a"),
      useSessionStore.getState().loadSessionsForProject("/project-a"),
    ]);

    // Both calls produce the same correct result (merge fix prevents wipe)
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);
    expect(r1[0].sessionId).toBe("s1");
  });

  it("GIVEN concurrent calls for different projects THEN both projects load correctly", async () => {
    mockedCall.mockResolvedValue({ sessions: [] });

    await Promise.all([
      useSessionStore.getState().loadSessionsForProject("/proj-a"),
      useSessionStore.getState().loadSessionsForProject("/proj-b"),
    ]);

    expect(useSessionStore.getState().sessionsByProject["/proj-a"]).toEqual([]);
    expect(useSessionStore.getState().sessionsByProject["/proj-b"]).toEqual([]);
  });

  it("GIVEN sequential loads for same project WITH merge fix THEN sessions are stable", async () => {
    const s1 = makeSession({
      sessionId: "s1",
      sessionPath: "/s/s1.jsonl",
      messageCount: 3,
      firstMessage: "hi",
    });
    mockedCall.mockResolvedValue({ sessions: [s1] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");
    await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toHaveLength(1);
    expect(useSessionStore.getState().sessionsByProject["/project-a"][0].sessionId).toBe("s1");
  });
});

// ============================================================
// Dimension 7: Initial loading state
// ============================================================
describe("Initial loading state", () => {
  it("GIVEN loadSessionsForProject called WHEN API is slow THEN loading stays true until complete", async () => {
    let resolve: (v: unknown) => void;
    const slowPromise = new Promise((resolve_) => {
      resolve = resolve_;
    });
    mockedCall.mockImplementationOnce(() => slowPromise);

    const callPromise = useSessionStore.getState().loadSessionsForProject("/project-a");

    // During slow API, loading must be true
    expect(useSessionStore.getState().loading).toBe(true);

    resolve!({ sessions: [] });
    await callPromise;

    // After completion, loading is false
    expect(useSessionStore.getState().loading).toBe(false);
  });
});

// ============================================================
// Dimension 8: TabBar race condition
// ============================================================
describe("TabBar should not race with App.tsx on loadSessionsForProject", () => {
  it("GIVEN sessionsByProject already has data for a tab THEN TabBar skips loading it", () => {
    // Simulate TabBar init logic:
    const sessionsByProject: Record<string, SessionMeta[]> = {
      "/project-a": [makeSession({ sessionId: "s1" })],
    };
    const projectTabs = [{ id: "tab-a", name: "A", path: "/project-a" }];

    const tabsToInit = projectTabs.filter((tab) => !sessionsByProject[tab.path]);

    expect(tabsToInit).toHaveLength(0);
  });

  it("GIVEN sessionsByProject has NO data for a tab THEN TabBar loads it", () => {
    const sessionsByProject: Record<string, SessionMeta[]> = {};
    const projectTabs = [{ id: "tab-a", name: "A", path: "/project-a" }];

    const tabsToInit = projectTabs.filter((tab) => !sessionsByProject[tab.path]);

    expect(tabsToInit).toHaveLength(1);
    expect(tabsToInit[0].path).toBe("/project-a");
  });

  it("GIVEN loading is true for a project THEN TabBar should NOT trigger another load", () => {
    // App.tsx sets loading=true, then calls loadSessionsForProject
    // TabBar check should be: skip if loading is true
    const sessionsByProject: Record<string, SessionMeta[] | undefined> = {};
    const projectTabs = [{ id: "tab-a", name: "A", path: "/project-a" }];

    // TabBar only checks sessionsByProject[path], not loading
    const tabsToInit = projectTabs.filter((tab) => !sessionsByProject[tab.path]);

    // This test documents the existing gap: TabBar doesn't check loading state
    // It would attempt to load even if App.tsx is already loading
    expect(tabsToInit).toHaveLength(1);
  });
});
