/**
 * TDD: onReconnect should refresh session list for the active project
 *
 * Bug: When WebSocket disconnects and reconnects, the onReconnect callback
 * restores the active session (agent.start, fetchInitialState) but does NOT
 * re-fetch the session list. This means sessions created/deleted/renamed
 * during the disconnect are not reflected in the UI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMeta, ProjectTab } from "../../../src/mainview/types";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

// We capture the onReconnect callback to invoke it manually in tests
// Using globalThis to survive vi.mock hoisting
vi.mock("../../../src/mainview/lib/api-client", () => {
  const captured: { callback: (() => void) | null } = { callback: null };
  // Expose for test access
  (globalThis as Record<string, unknown>).__reconnectCapture = captured;
  return {
    apiClient: {
      call: vi.fn().mockResolvedValue({}),
      onReconnect: vi.fn((cb: () => void) => {
        captured.callback = cb;
      }),
      subscribe: vi.fn(() => Promise.resolve("sub-id")),
      unsubscribe: vi.fn(),
    },
  };
});

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: () => ({
      getCurrentTierForSession: vi.fn(() => null),
      getTierModelsForSession: vi.fn(() => ({})),
      syncTierFromModelForSession: vi.fn(),
      switchToTier: vi.fn(),
      setGlobalDefaults: vi.fn(),
      fetchTierConfig: vi.fn().mockResolvedValue(undefined),
      dataBySession: {},
      globalDefaults: {},
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: () => ({
      loadSessionMessages: vi.fn(() => Promise.resolve()),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: () => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: () => ({
      fetchWorktrees: vi.fn(),
      fetchStatus: vi.fn(),
      fetchBranches: vi.fn(),
      checkGitRepo: vi.fn().mockResolvedValue(false),
    }),
  },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: () => ({ setPlugins: vi.fn(), setSkills: vi.fn(), setMcpServers: vi.fn() }),
  },
  deriveSkillScope: () => "project" as const,
  derivePluginScope: () => "project" as const,
}));

vi.mock("../../../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({ clearSessionUI: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({ clearSessionUI: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: { getState: () => ({ endRetry: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({ clearSessionData: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: { getState: () => ({ clearSessionData: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-bash-store", () => ({
  useBashStore: { getState: () => ({ clearSessionData: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: { getState: () => ({ clearSessionData: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: { getState: () => ({ clearSessionData: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: () => ({ addEntry: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>, sessionId: string) => {
    const omitSession = (value: unknown) => {
      const map = (value ?? {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(map).filter(([key]) => key !== sessionId));
    };
    return {
      agentSubscriptions: omitSession(s.agentSubscriptions),
      subagentSubscriptions: omitSession(s.subagentSubscriptions),
      todoSubscriptions: omitSession(s.todoSubscriptions),
      bashSubscriptions: omitSession(s.bashSubscriptions),
      lspSubscriptions: omitSession(s.lspSubscriptions),
      rulesSubscriptions: omitSession(s.rulesSubscriptions),
      notifySubscriptions: omitSession(s.notifySubscriptions),
      memorySubscriptions: omitSession(s.memorySubscriptions),
      coordinatorSubscriptions: omitSession(s.coordinatorSubscriptions),
      supervisorSubscriptions: omitSession(s.supervisorSubscriptions),
      goalSubscriptions: omitSession(s.goalSubscriptions),
      sessionReady: omitSession(s.sessionReady),
    };
  },
  syncTabsToBackend: vi.fn(),
  requestRulesSnapshot: vi.fn(),
  clearStatusWatchdog: vi.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import {
  cleanupSession,
  setupSubscriptions,
} from "../../../src/mainview/stores/session-subscriptions";

const mockedCall = apiClient.call as unknown as ReturnType<typeof vi.fn>;
const mockedLoadSessionMessages = vi.fn(() => Promise.resolve());

// Override the mock's loadSessionMessages with a spy we can inspect
(useChatStore as unknown as { getState: () => Record<string, unknown> }).getState = () => ({
  loadSessionMessages: mockedLoadSessionMessages,
  clearSessionMessages: vi.fn(),
  messagesBySession: {},
});

const TAB_A: ProjectTab = { id: "tab-a", name: "Project A", path: "/project-a" };

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  const sid = overrides.sessionId ?? "sess-1";
  return {
    sessionId: sid,
    name: "",
    sessionPath: `/sessions/${sid}`,
    projectPath: "/project-a",
    parentSessionPath: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
    ...overrides,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getReconnectCallback(): () => void {
  const captured = (globalThis as Record<string, unknown>).__reconnectCapture as
    | { callback: (() => void) | null }
    | undefined;
  if (!captured?.callback) {
    throw new Error("onReconnect callback was not registered during store initialization");
  }
  return captured.callback;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("onReconnect - session list refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessionsByProject: {},
      activeSessionId: null,
      projectTabs: [],
      activeProjectId: null,
      loading: false,
      agentSubscriptions: {},
      batchSubscriptions: {},
      subagentSubscriptions: {},
      todoSubscriptions: {},
      bashSubscriptions: {},
      lspSubscriptions: {},
      rulesSubscriptions: {},
      notifySubscriptions: {},
      memorySubscriptions: {},
      sessionReady: {},
      sessionContextMap: {},
      sessionStatusMap: {},
      currentModel: null,
      currentThinkingLevel: "medium",
      availableModels: [],
      projectStartFailed: {},
      projectStartError: {},
      _projectVersion: 0,
    });
  });

  it("should call loadSessionsForProject (project.scanSessions) after reconnect", async () => {
    // Setup: one project tab with one existing session
    const oldSession = makeSession({ sessionId: "sess-old" });
    const newSession = makeSession({ sessionId: "sess-new-during-disconnect" });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      sessionsByProject: { "/project-a": [oldSession] },
    });

    // Mock: dispatch by method name so intermediate calls (fetchInitialState) don't consume wrong mock
    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") return Promise.resolve({ status: "started" });
      if (method === "project.scanSessions")
        return Promise.resolve({ sessions: [oldSession, newSession] });
      return Promise.resolve({});
    });

    // Act: simulate reconnect
    const onReconnect = getReconnectCallback();
    onReconnect();

    // Wait for async chain: agent.start → .then → loadSessionsForProject
    await new Promise((r) => setTimeout(r, 200));

    // Verify: project.scanSessions was called for the active project
    const allCalls = mockedCall.mock.calls.map((c: unknown[]) => c[0]);
    expect(allCalls).toContain("project.scanSessions");

    // Verify: session list now includes the new session
    const sessions = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(sessions).toBeDefined();
    expect(sessions.find((s) => s.sessionId === "sess-new-during-disconnect")).toBeDefined();
  });

  it("should refresh session list even when agent.start returns already_running", async () => {
    const oldSession = makeSession({ sessionId: "sess-old" });
    const updatedSession = makeSession({
      sessionId: "sess-old",
      name: "Renamed During Disconnect",
      messageCount: 5,
    });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      sessionsByProject: { "/project-a": [oldSession] },
    });

    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") return Promise.resolve({ status: "already_running" });
      if (method === "project.scanSessions") return Promise.resolve({ sessions: [updatedSession] });
      return Promise.resolve({});
    });

    const onReconnect = getReconnectCallback();
    onReconnect();

    await vi.waitFor(() => {
      expect(mockedCall).toHaveBeenCalledWith("project.scanSessions", {
        projectPath: "/project-a",
      });
    });
  });

  it("should drop stale active subscriptions and resubscribe after reconnect", async () => {
    const oldSession = makeSession({ sessionId: "sess-old" });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      sessionsByProject: { "/project-a": [oldSession] },
      agentSubscriptions: { "sess-old": "stale-agent-sub" },
      subagentSubscriptions: { "sess-old": "stale-subagent-sub" },
      sessionReady: { "sess-old": true },
    });

    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") return Promise.resolve({ status: "already_running" });
      if (method === "project.scanSessions") return Promise.resolve({ sessions: [oldSession] });
      return Promise.resolve({});
    });

    getReconnectCallback()();

    await vi.waitFor(() => {
      expect(cleanupSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSubscriptions: expect.objectContaining({ "sess-old": "stale-agent-sub" }),
        }),
        "sess-old",
      );
      expect(setupSubscriptions).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSubscriptions: {},
          subagentSubscriptions: {},
          sessionReady: {},
        }),
        expect.any(Function),
        "sess-old",
        expect.objectContaining({ sessionId: "sess-old" }),
      );
    });
  });

  it("should not crash if session list fetch fails after reconnect", async () => {
    const oldSession = makeSession({ sessionId: "sess-old" });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      sessionsByProject: { "/project-a": [oldSession] },
    });

    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") return Promise.resolve({ status: "started" });
      if (method === "project.scanSessions") return Promise.reject(new Error("network error"));
      return Promise.resolve({});
    });

    const onReconnect = getReconnectCallback();
    // Should not throw
    onReconnect();

    // Wait a bit for async to settle
    await new Promise((r) => setTimeout(r, 100));

    // Old sessions should still be intact
    const sessions = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("sess-old");
  });

  it("should skip session list refresh when there is no active session", async () => {
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: null,
      sessionsByProject: {},
    });

    const onReconnect = getReconnectCallback();
    onReconnect();

    // Wait a bit for async to settle
    await new Promise((r) => setTimeout(r, 100));

    // scanSessions should NOT be called since there's no active session
    expect(mockedCall).not.toHaveBeenCalledWith("project.scanSessions", expect.anything());
  });

  it("should restore persisted tabs before reconnect recovery when the active tab is missing", async () => {
    const oldSession = makeSession({ sessionId: "sess-old" });
    useSessionStore.setState({
      projectTabs: [],
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      sessionsByProject: { "/project-a": [oldSession] },
    });

    mockedCall.mockImplementation((method: string) => {
      if (method === "project.restoreTabs") {
        return Promise.resolve({ tabs: [TAB_A], activeTabId: "tab-a" });
      }
      if (method === "agent.start") return Promise.resolve({ status: "started" });
      if (method === "project.scanSessions") return Promise.resolve({ sessions: [oldSession] });
      return Promise.resolve({});
    });

    const onReconnect = getReconnectCallback();
    onReconnect();

    await vi.waitFor(() => {
      expect(mockedCall).toHaveBeenCalledWith("project.restoreTabs", {});
      expect(mockedCall).toHaveBeenCalledWith("project.scanSessions", {
        projectPath: "/project-a",
      });
    });

    expect(useSessionStore.getState().projectTabs).toEqual([TAB_A]);
    expect(useSessionStore.getState().activeProjectId).toBe("tab-a");
  });

  it("should force-reload messages after reconnect to recover missed events", async () => {
    const oldSession = makeSession({ sessionId: "sess-old" });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      sessionsByProject: { "/project-a": [oldSession] },
    });

    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") return Promise.resolve({ status: "already_running" });
      if (method === "project.scanSessions") return Promise.resolve({ sessions: [oldSession] });
      return Promise.resolve({});
    });

    const onReconnect = getReconnectCallback();
    onReconnect();

    await new Promise((r) => setTimeout(r, 200));

    // loadSessionMessages must be called with force: true
    expect(mockedLoadSessionMessages).toHaveBeenCalledWith(
      "sess-old",
      expect.objectContaining({ force: true }),
    );
  });
});
