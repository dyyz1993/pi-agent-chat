import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

const mockClearSessionMessages = vi.fn();
const mockMessagesBySession: Record<string, unknown[]> = {};

vi.mock("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
      clearSessionMessages: mockClearSessionMessages,
      messagesBySession: mockMessagesBySession,
      saveInputDraft: vi.fn(),
      restoreInputDraft: vi.fn(),
      clearInputDraft: vi.fn(),
    })),
    setState: vi.fn(),
  },
  clearBackgroundRefreshGeneration: vi.fn(),
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

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn(), clearSessionData: vi.fn() })),
  },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

const mockClearSessionUITurn = vi.fn();
const mockClearSessionUINav = vi.fn();

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: {
    getState: vi.fn(() => ({ clearSessionUI: mockClearSessionUITurn })),
  },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: {
    getState: vi.fn(() => ({ clearSessionUI: mockClearSessionUINav })),
  },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ clearSession: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: {
    getState: vi.fn(() => ({ clearSession: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: {
    getState: vi.fn(() => ({ clearSession: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: {
    getState: vi.fn(() => ({ clearSession: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: vi.fn(() => ({
      checkGitRepo: vi.fn().mockResolvedValue(false),
      clearDiff: vi.fn(),
    })),
  },
}));

import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useSubagentStore } from "../src/mainview/stores/use-subagent-store";
import { apiClient } from "../src/mainview/lib/api-client";
import type { SessionMeta, ProjectTab } from "../src/mainview/types";

const mockedCall = vi.mocked(apiClient.call);

const TAB_A: ProjectTab = { id: "tab-a", name: "Project A", path: "/project-a" };

function makeSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: "sess-1",
    name: "",
    sessionPath: "/sessions/sess-1.jsonl",
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
  useSubagentStore.setState({
    subsessionsByParent: {},
    activeSubsessionId: null,
    messagesBySubsession: {},
    loadingByParent: {},
    subagentStatusMap: {},
    subagentContextMap: {},
  });
});

describe("Bug #1: renameSession allows empty/whitespace names", () => {
  it("should NOT call RPC when newName is an empty string", () => {
    const session = makeSession({ sessionId: "sess-1", name: "Original Name" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().renameSession("sess-1", "");

    const updated = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(updated[0].name).toBe("Original Name");
    expect(mockedCall).not.toHaveBeenCalledWith("session.rename", expect.anything());
  });

  it("should NOT call RPC when newName is whitespace-only", () => {
    const session = makeSession({ sessionId: "sess-1", name: "Original Name" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().renameSession("sess-1", "   ");

    const updated = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(updated[0].name).toBe("Original Name");
    expect(mockedCall).not.toHaveBeenCalledWith("session.rename", expect.anything());
  });

  it("should accept a valid trimmed name", () => {
    const session = makeSession({ sessionId: "sess-1", name: "" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().renameSession("sess-1", "  New Name  ");

    const updated = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(updated[0].name).toBe("New Name");
    expect(mockedCall).toHaveBeenCalledWith(
      "session.rename",
      expect.objectContaining({ newName: "New Name" }),
    );
  });
});

describe("Bug #2: deleteSession does not clean up subagent data", () => {
  it("should clear subsessionsByParent for the deleted session's parent path", () => {
    const sessionPath = "/sessions/sess-1.jsonl";
    const session = makeSession({ sessionId: "sess-1", sessionPath });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
      activeSessionId: "sess-1",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSubagentStore.setState({
      subsessionsByParent: {
        [sessionPath]: [
          {
            sessionId: "sub-1",
            sessionPath: "/sessions/sub-1.jsonl",
            description: "A subagent",
            instruction: "Do work",
            startedAt: Date.now(),
          },
        ],
      },
      messagesBySubsession: {
        "sub-1": [{ id: "m1", role: "user" as const, content: [], timestamp: 0 }],
      },
      subagentStatusMap: { "sub-1": "idle" },
      subagentContextMap: { "sub-1": { tokens: null, contextWindow: 0 } },
      activeSubsessionId: "sub-1",
    });

    useSessionStore.getState().deleteSession("sess-1");

    expect(useSubagentStore.getState().subsessionsByParent[sessionPath]).toBeUndefined();
    expect(useSubagentStore.getState().messagesBySubsession["sub-1"]).toBeUndefined();
    expect(useSubagentStore.getState().subagentStatusMap["sub-1"]).toBeUndefined();
    expect(useSubagentStore.getState().subagentContextMap["sub-1"]).toBeUndefined();
    expect(useSubagentStore.getState().activeSubsessionId).toBeNull();
  });

  it("should not clear subagent data for OTHER sessions", () => {
    const sess1Path = "/sessions/sess-1.jsonl";
    const sess2Path = "/sessions/sess-2.jsonl";
    const session1 = makeSession({ sessionId: "sess-1", sessionPath: sess1Path });
    const session2 = makeSession({ sessionId: "sess-2", sessionPath: sess2Path });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session1, session2] },
      activeSessionId: "sess-1",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSubagentStore.setState({
      subsessionsByParent: {
        [sess1Path]: [
          {
            sessionId: "sub-1",
            sessionPath: "/sessions/sub-1.jsonl",
            description: "Sub for sess-1",
            instruction: "",
            startedAt: Date.now(),
          },
        ],
        [sess2Path]: [
          {
            sessionId: "sub-2",
            sessionPath: "/sessions/sub-2.jsonl",
            description: "Sub for sess-2",
            instruction: "",
            startedAt: Date.now(),
          },
        ],
      },
      messagesBySubsession: {
        "sub-2": [{ id: "m1", role: "user" as const, content: [], timestamp: 0 }],
      },
    });

    useSessionStore.getState().deleteSession("sess-1");

    expect(useSubagentStore.getState().subsessionsByParent[sess1Path]).toBeUndefined();
    expect(useSubagentStore.getState().subsessionsByParent[sess2Path]).toHaveLength(1);
    expect(useSubagentStore.getState().messagesBySubsession["sub-2"]).toHaveLength(1);
  });
});

describe("Bug #3: deleteSession active session - no auto-switch", () => {
  it("should switch to the next available session when active is deleted", () => {
    const session1 = makeSession({ sessionId: "sess-1", name: "Active" });
    const session2 = makeSession({ sessionId: "sess-2", name: "Other" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session1, session2] },
      activeSessionId: "sess-1",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSessionStore.getState().deleteSession("sess-1");

    const state = useSessionStore.getState();
    expect(state.sessionsByProject["/project-a"]).toHaveLength(1);
    expect(state.activeSessionId).toBe("sess-2");
  });
});
