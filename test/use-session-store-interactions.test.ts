import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return {
    ...actual,
    persist: (fn: unknown) => fn,
  };
});

const mockClearSessionUITurn = vi.fn();
const mockClearSessionUINav = vi.fn();

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: vi.fn(() => ({
      currentTier: null,
      syncTierFromModel: vi.fn(),
      switchToTier: vi.fn(),
    })),
  },
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
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: {
    getState: vi.fn(() => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: vi.fn(() => ({
      checkGitRepo: vi.fn().mockResolvedValue(false),
      fetchWorktrees: vi.fn(),
      fetchStatus: vi.fn(),
      fetchBranches: vi.fn(),
    })),
  },
}));

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({
      setPlugins: vi.fn(),
      setSkills: vi.fn(),
      setMcpServers: vi.fn(),
    })),
  },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: {
    getState: () => ({ clearSessionUI: mockClearSessionUITurn }),
  },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: {
    getState: () => ({ clearSessionUI: mockClearSessionUINav }),
  },
}));

vi.mock("../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: {
    getState: vi.fn(() => ({ endRetry: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
}));

import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { SessionMeta, ProjectTab } from "../src/mainview/types";

const mockedCall = vi.mocked(apiClient.call);

const TAB_A: ProjectTab = { id: "tab-a", name: "Project A", path: "/project-a" };

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "sess-1",
    name: "",
    sessionPath: "/sessions/sess-1",
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

beforeEach(() => {
  vi.clearAllMocks();
  mockClearSessionUITurn.mockClear();
  mockClearSessionUINav.mockClear();
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

describe("togglePinSession flow", () => {
  it("pins a session then unpins it", () => {
    const session = makeSession({ sessionId: "sess-1", pinned: false });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().togglePinSession("sess-1");
    expect(useSessionStore.getState().sessionsByProject["/project-a"][0].pinned).toBe(true);

    useSessionStore.getState().togglePinSession("sess-1");
    expect(useSessionStore.getState().sessionsByProject["/project-a"][0].pinned).toBe(false);
  });

  it("calls session.pin RPC when pinning and session.unpin when unpinning", () => {
    const session = makeSession({ sessionId: "sess-1", pinned: false });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().togglePinSession("sess-1");
    expect(mockedCall).toHaveBeenCalledWith("session.pin", { sessionId: "sess-1" });

    mockedCall.mockClear();
    useSessionStore.getState().togglePinSession("sess-1");
    expect(mockedCall).toHaveBeenCalledWith("session.unpin", { sessionId: "sess-1" });
  });
});

describe("renameSession flow", () => {
  it("renames session in store and calls session.rename RPC", () => {
    const session = makeSession({ sessionId: "sess-1", sessionPath: "/s/1", name: "old" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().renameSession("sess-1", "New Name");

    expect(useSessionStore.getState().sessionsByProject["/project-a"][0].name).toBe("New Name");
    expect(mockedCall).toHaveBeenCalledWith(
      "session.rename",
      expect.objectContaining({ sessionId: "sess-1", newName: "New Name" }),
    );
  });
});

describe("deleteSession flow", () => {
  it("removes from sessionsByProject and calls session.delete RPC", () => {
    const session = makeSession({ sessionId: "del-me", sessionPath: "/s/del" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
      activeSessionId: null,
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
    });

    useSessionStore.getState().deleteSession("del-me");

    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toHaveLength(0);
    expect(mockedCall).toHaveBeenCalledWith(
      "agent.stop",
      expect.objectContaining({ sessionId: "del-me" }),
    );
  });

  it("switches activeSessionId to next session when deleting the active session", () => {
    const s1 = makeSession({ sessionId: "active-one" });
    const s2 = makeSession({ sessionId: "other" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [s1, s2] },
      activeSessionId: "active-one",
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
    });

    useSessionStore.getState().deleteSession("active-one");

    expect(useSessionStore.getState().activeSessionId).toBe("other");
    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toHaveLength(1);
  });
});

describe("addProjectTab flow", () => {
  it("adds a new tab and sets activeProjectId", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    const state = useSessionStore.getState();
    expect(state.projectTabs).toHaveLength(1);
    expect(state.activeProjectId).toBe("tab-a");
  });

  it("reuses existing tab with same path instead of duplicating", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab({ ...TAB_A, id: "tab-a-dup" });
    expect(useSessionStore.getState().projectTabs).toHaveLength(1);
  });
});

describe("setActiveSession flow", () => {
  it("changes activeSessionId", () => {
    const session = makeSession({ sessionId: "sess-target" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: null,
    });
    mockedCall.mockResolvedValue({
      status: "started",
      sessionId: "sess-target",
      sessionPath: "/sessions/sess-target",
      projectPath: "/project-a",
    });

    useSessionStore.getState().setActiveSession("sess-target");

    expect(useSessionStore.getState().activeSessionId).toBe("sess-target");
  });
});

describe("session status transitions", () => {
  it("transitions through idle → streaming → compacting → idle", () => {
    useSessionStore.getState().updateSessionStatus("s1", "idle");
    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("idle");

    useSessionStore.getState().updateSessionStatus("s1", "streaming");
    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("streaming");

    useSessionStore.getState().updateSessionStatus("s1", "compacting");
    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("compacting");

    useSessionStore.getState().updateSessionStatus("s1", "idle");
    expect(useSessionStore.getState().sessionStatusMap["s1"]).toBe("idle");
  });
});

describe("context usage update", () => {
  it("merges partial updates preserving existing fields", () => {
    useSessionStore.getState().updateSessionContext("s1", { tokens: 500, contextWindow: 200000 });

    useSessionStore.getState().updateSessionContext("s1", { tokens: 1500 });

    const ctx = useSessionStore.getState().sessionContextMap["s1"];
    expect(ctx.tokens).toBe(1500);
    expect(ctx.contextWindow).toBe(200000);
  });
});

describe("queue update", () => {
  it("setSessionQueue updates queueBySession via setState", () => {
    useSessionStore.setState({
      queueBySession: {
        s1: { steering: ["a"], followUp: [] },
      },
    });
    expect(useSessionStore.getState().queueBySession["s1"].steering).toEqual(["a"]);
  });
});
