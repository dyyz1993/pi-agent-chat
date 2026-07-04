import { describe, it, expect, beforeEach, vi } from "vitest";

const chatStoreState = vi.hoisted(() => ({
  loadSessionMessages: vi.fn().mockResolvedValue(undefined),
  _backgroundRefreshMessages: vi.fn().mockResolvedValue(undefined),
  clearSessionMessages: vi.fn(),
  messagesBySession: {} as Record<string, unknown[]>,
  saveInputDraft: vi.fn(),
  restoreInputDraft: vi.fn(),
  clearInputDraft: vi.fn(),
}));

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return {
    ...actual,
    persist: (fn: unknown) => fn,
  };
});

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => chatStoreState),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: {
    getState: vi.fn(() => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({
      setPlugins: vi.fn(),
      setSkills: vi.fn(),
      getRememberedPermissionProfile: vi.fn(() => null),
      applyPermissionProfileSnapshot: vi.fn(),
    })),
  },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

vi.mock("../../../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: {
    getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: {
    getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: vi.fn(() => ({
      checkGitRepo: vi.fn().mockResolvedValue(false),
      fetchWorktrees: vi.fn(),
      fetchStatus: vi.fn(),
      fetchBranches: vi.fn(),
      clearDiff: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ clearSessionData: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: {
    getState: vi.fn(() => ({ clearSessionData: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-bash-store", () => ({
  useBashStore: {
    getState: vi.fn(() => ({ clearSessionData: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: {
    getState: vi.fn(() => ({ clearSessionData: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: {
    getState: vi.fn(() => ({ clearSessionData: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  requestRulesSnapshot: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    delete (s as Record<string, unknown>).batchSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
}));

import {
  clearAgentStarted,
  markAgentStarted,
  useSessionStore,
} from "../../../src/mainview/stores/use-session-store";
import { useSessionTodoStore } from "../../../src/mainview/stores/use-session-todo-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useExplorerStore } from "../../../src/mainview/stores/use-explorer-store";
import { useGitStore } from "../../../src/mainview/stores/use-git-store";
import { setupSubscriptions } from "../../../src/mainview/stores/session-subscriptions";
import { useStatusStore } from "../../../src/mainview/stores/use-status-store";
import { useTierStore } from "../../../src/mainview/stores/use-tier-store";
import type { SessionMeta, ProjectTab } from "../../../src/mainview/types";

const mockedCall = apiClient.call as unknown as ReturnType<typeof vi.fn>;

const TAB_A: ProjectTab = { id: "tab-a", name: "Project A", path: "/project-a" };
const TAB_B: ProjectTab = { id: "tab-b", name: "Project B", path: "/project-b" };

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

beforeEach(() => {
  vi.clearAllMocks();
  chatStoreState.loadSessionMessages.mockResolvedValue(undefined);
  chatStoreState._backgroundRefreshMessages.mockResolvedValue(undefined);
  chatStoreState.messagesBySession = {};
  clearAgentStarted("sess-1");
  clearAgentStarted("sess-2");
  vi.mocked(useExplorerStore.getState).mockReturnValue({
    setCurrentPath: vi.fn(),
    listRootDir: vi.fn(),
  });
  vi.mocked(useGitStore.getState).mockReturnValue({
    checkGitRepo: vi.fn().mockResolvedValue(false),
    fetchWorktrees: vi.fn(),
    fetchStatus: vi.fn(),
    fetchBranches: vi.fn(),
    clearDiff: vi.fn(),
  });
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

describe("addProjectTab", () => {
  it("adds a new tab and sets it as active", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    const state = useSessionStore.getState();
    expect(state.projectTabs).toHaveLength(1);
    expect(state.activeProjectId).toBe("tab-a");
  });

  it("does not duplicate tab with same path", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab({ ...TAB_A, id: "tab-a-dup" });
    const state = useSessionStore.getState();
    expect(state.projectTabs).toHaveLength(1);
    expect(state.activeProjectId).toBe("tab-a");
  });

  it("merges remote metadata into an existing tab with the same path", () => {
    const localPath = "/Users/me/.pi-agent-chat/remote-projects/ssh-44444";
    const remoteTab: ProjectTab = {
      id: "remote-44444",
      name: "44444",
      path: localPath,
      runtime: "ssh",
      remote: {
        runtime: "ssh",
        sshRuntimeKind: "remote-agent-child",
        profileId: "profile-1",
        host: "xyz-mac",
        remotePath: "/Users/xyz/Projects/44444",
        localPath,
      },
    };

    useSessionStore.getState().addProjectTab({
      id: "local-shadow",
      name: "44444",
      path: localPath,
    });
    useSessionStore.getState().addProjectTab(remoteTab);

    const state = useSessionStore.getState();
    expect(state.projectTabs).toHaveLength(1);
    expect(state.activeProjectId).toBe("local-shadow");
    expect(state.projectTabs[0]).toMatchObject({
      id: "local-shadow",
      runtime: "ssh",
      remote: {
        remotePath: "/Users/xyz/Projects/44444",
        sshRuntimeKind: "remote-agent-child",
      },
    });
  });

  it("adds multiple tabs with different paths", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab(TAB_B);
    expect(useSessionStore.getState().projectTabs).toHaveLength(2);
  });
});

describe("removeProjectTab", () => {
  it("removes a tab and switches active to last remaining", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab(TAB_B);
    useSessionStore.getState().removeProjectTab("tab-b");
    const state = useSessionStore.getState();
    expect(state.projectTabs).toHaveLength(1);
    expect(state.activeProjectId).toBe("tab-a");
  });

  it("sets activeProjectId to null when removing the last tab", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().removeProjectTab("tab-a");
    expect(useSessionStore.getState().activeProjectId).toBeNull();
  });

  it("does not affect other tabs when removing non-active tab", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab(TAB_B);
    useSessionStore.getState().removeProjectTab("tab-a");
    expect(useSessionStore.getState().projectTabs[0].id).toBe("tab-b");
  });

  it("calls setActiveProject for the new tab when closing the active project tab", async () => {
    const sessions = [makeSession({ sessionId: "sess-b1", projectPath: "/project-b" })];
    mockedCall.mockResolvedValueOnce({ sessions });

    useSessionStore.setState({
      projectTabs: [TAB_A, TAB_B],
      activeProjectId: "tab-b",
      activeSessionId: "sess-old",
      sessionsByProject: {},
    });

    useSessionStore.getState().removeProjectTab("tab-b");

    await vi.waitFor(() => {
      const state = useSessionStore.getState();
      expect(state.activeProjectId).toBe("tab-a");
      expect(state._projectVersion).toBeGreaterThan(0);
      expect(state.activeSessionId).not.toBe("sess-old");
    });

    expect(mockedCall).toHaveBeenCalledWith(
      "project.scanSessions",
      expect.objectContaining({ projectPath: "/project-a" }),
    );
  });

  it("does not call setActiveProject when closing a non-active tab", () => {
    const versionBefore = useSessionStore.getState()._projectVersion;

    useSessionStore.setState({
      projectTabs: [TAB_A, TAB_B],
      activeProjectId: "tab-a",
      activeSessionId: "sess-a",
      sessionsByProject: { "/project-a": [makeSession({ sessionId: "sess-a" })] },
    });

    useSessionStore.getState().removeProjectTab("tab-b");

    expect(useSessionStore.getState()._projectVersion).toBe(versionBefore);
    expect(useSessionStore.getState().activeProjectId).toBe("tab-a");
  });

  it("does not call setActiveProject when closing the last remaining tab", () => {
    const versionBefore = useSessionStore.getState()._projectVersion;

    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      activeSessionId: "sess-a",
    });

    useSessionStore.getState().removeProjectTab("tab-a");

    expect(useSessionStore.getState().activeProjectId).toBeNull();
    expect(useSessionStore.getState()._projectVersion).toBe(versionBefore);
  });
});

describe("reorderProjectTabs", () => {
  it("moves tab from one index to another", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab(TAB_B);
    useSessionStore.getState().addProjectTab({ id: "tab-c", name: "C", path: "/c" });

    useSessionStore.getState().reorderProjectTabs(0, 2);

    const tabs = useSessionStore.getState().projectTabs;
    expect(tabs[0].id).toBe("tab-b");
    expect(tabs[1].id).toBe("tab-c");
    expect(tabs[2].id).toBe("tab-a");
  });

  it("handles same index reorder as no-op", () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.getState().addProjectTab(TAB_B);

    useSessionStore.getState().reorderProjectTabs(0, 0);

    const tabs = useSessionStore.getState().projectTabs;
    expect(tabs[0].id).toBe("tab-a");
  });
});

describe("setActiveProject", () => {
  it("does not override a newly created active session when the same project reconnects", () => {
    const oldSession = makeSession({
      sessionId: "old-sess",
      projectPath: TAB_A.path,
      messageCount: 2,
      firstMessage: "old",
    });
    const newSession = makeSession({
      sessionId: "new-worktree-sess",
      projectPath: "/worktree-a",
      messageCount: 0,
      firstMessage: "",
    });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: TAB_A.id,
      activeSessionId: "new-worktree-sess",
      sessionsByProject: {
        [TAB_A.path]: [oldSession],
        "/worktree-a": [newSession],
      },
      lastActiveSessionByProject: { [TAB_A.path]: "old-sess" },
      newSessionCreatedAt: Date.now(),
    });

    useSessionStore.getState().setActiveProject(TAB_A.id);

    expect(useSessionStore.getState().activeSessionId).toBe("new-worktree-sess");
  });

  it("uses the remote workspace path for explorer and git operations", async () => {
    const localPath = "/Users/me/.pi-agent-chat/remote-projects/ssh-demo";
    const remotePath = "/Users/xyz/Projects/demo1";
    const remoteTab: ProjectTab = {
      id: "remote-demo",
      name: "demo1",
      path: localPath,
      runtime: "ssh",
      remote: {
        runtime: "ssh",
        sshRuntimeKind: "remote-agent-child",
        profileId: "profile-1",
        host: "xyz-mac",
        remotePath,
        localPath,
      },
    };
    const explorer = { setCurrentPath: vi.fn(), listRootDir: vi.fn() };
    const git = {
      checkGitRepo: vi.fn().mockResolvedValue(false),
      fetchWorktrees: vi.fn(),
      fetchStatus: vi.fn(),
      fetchBranches: vi.fn(),
      clearDiff: vi.fn(),
    };
    vi.mocked(useExplorerStore.getState).mockReturnValue(explorer);
    vi.mocked(useGitStore.getState).mockReturnValue(git);

    useSessionStore.setState({
      projectTabs: [remoteTab],
      activeProjectId: null,
      activeSessionId: null,
      sessionsByProject: {},
    });

    useSessionStore.getState().setActiveProject("remote-demo", { skipAutoSession: true });

    expect(explorer.setCurrentPath).toHaveBeenCalledWith(remotePath);
    expect(git.checkGitRepo).toHaveBeenCalledWith(remotePath);
    expect(mockedCall).not.toHaveBeenCalledWith(
      "project.scanSessions",
      expect.objectContaining({ projectPath: remotePath }),
    );
  });
});

describe("setActiveSession", () => {
  it("cold-starts by preloading messages once without a second background refresh", async () => {
    const session = makeSession({ sessionId: "sess-cold", projectPath: TAB_A.path });
    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") {
        return Promise.resolve({ agentId: "sess-cold", status: "started" });
      }
      if (method === "agent.getContextUsage") return Promise.resolve({ tokens: 123 });
      if (method === "agent.getAvailableModels") return Promise.resolve({ models: [] });
      if (method === "agent.getSettings") return Promise.resolve({});
      if (method === "agent.getExtensions") return Promise.resolve({ extensions: [] });
      if (method === "agent.getSkills") return Promise.resolve({ skills: [] });
      if (method === "agent.getMcpServers") return Promise.resolve({ servers: [] });
      if (method === "agent.getQueue") return Promise.resolve({ queue: [] });
      if (method === "agent.getLatestAgentChange") return Promise.resolve({ change: null });
      if (method === "agent.getAgents") return Promise.resolve({ agents: [] });
      if (method === "agent.getCurrentAgent") return Promise.resolve({ agent: null });
      if (method === "agent.getTierModels") return Promise.resolve({});
      if (method === "project.getModelFavorites") return Promise.resolve({ favorites: [] });
      if (method === "project.getAgentFavorites") return Promise.resolve({ favorites: [] });
      if (method === "session.loadTierConfig") return Promise.resolve(null);
      return Promise.resolve({});
    });

    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: TAB_A.id,
      activeSessionId: null,
      sessionsByProject: { [TAB_A.path]: [session] },
      projectStartFailed: { [TAB_A.id]: false },
      projectStartError: { [TAB_A.id]: "" },
      sessionReady: {},
      agentReady: {},
    });

    useSessionStore.getState().setActiveSession("sess-cold", true);

    await vi.waitFor(() => {
      expect(useSessionStore.getState().agentReady["sess-cold"]).toBe(true);
      expect(mockedCall).toHaveBeenCalledWith("agent.getContextUsage", {
        sessionId: "sess-cold",
      });
    });

    expect(chatStoreState.loadSessionMessages).toHaveBeenCalledTimes(1);
    expect(chatStoreState.loadSessionMessages).toHaveBeenCalledWith("sess-cold", {
      force: true,
      sessionPath: "/sessions/sess-cold",
    });
    expect(chatStoreState._backgroundRefreshMessages).not.toHaveBeenCalled();
  });

  it("refreshes permission state when switching to a known running session", async () => {
    const applyPermissionProfileSnapshot = vi.fn();
    vi.mocked(useStatusStore.getState).mockReturnValue({
      setPlugins: vi.fn(),
      setSkills: vi.fn(),
      getRememberedPermissionProfile: vi.fn(() => "yolo"),
      applyPermissionProfileSnapshot,
    });

    const session = makeSession({ sessionId: "sess-1", projectPath: TAB_A.path });
    markAgentStarted("sess-1");
    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          permissionMode: "yolo",
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
        });
      }
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: null, contextWindow: 0 });
      if (method === "agent.getAvailableModels") return Promise.resolve({ models: [] });
      if (method === "agent.getSettings") return Promise.resolve({});
      if (method === "agent.getExtensions") return Promise.resolve({ extensions: [] });
      if (method === "agent.getSkills") return Promise.resolve({ skills: [] });
      if (method === "agent.getDisabledSkills") return Promise.resolve({ disabledSkills: [] });
      if (method === "agent.getDisabledPlugins") return Promise.resolve({ disabledPlugins: [] });
      return Promise.resolve({});
    });

    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: TAB_A.id,
      activeSessionId: null,
      sessionsByProject: { [TAB_A.path]: [session] },
      projectStartFailed: { [TAB_A.id]: false },
      projectStartError: { [TAB_A.id]: "" },
      sessionReady: {},
      agentReady: {},
    });

    useSessionStore.getState().setActiveSession("sess-1", true);

    await vi.waitFor(() => {
      expect(applyPermissionProfileSnapshot).toHaveBeenCalledWith("yolo", "sess-1");
      expect(mockedCall).toHaveBeenCalledWith("agent.getState", { sessionId: "sess-1" });
    });

    expect(mockedCall).not.toHaveBeenCalledWith(
      "agent.start",
      expect.objectContaining({ sessionId: "sess-1" }),
    );
  });

  it("ignores stale agent.start timeout after a newer start succeeds", async () => {
    vi.useFakeTimers();

    const session = makeSession({ sessionId: "sess-1", projectPath: TAB_A.path });
    let startCalls = 0;
    mockedCall.mockImplementation((method: string) => {
      if (method === "agent.start") {
        startCalls += 1;
        if (startCalls === 1) return new Promise(() => {});
        return Promise.resolve({ agentId: "sess-1", status: "started" });
      }
      if (method === "agent.getContextUsage") return Promise.resolve({ tokens: 0 });
      if (method === "agent.getAvailableModels") return Promise.resolve({ models: [] });
      if (method === "agent.getSettings") return Promise.resolve({});
      if (method === "agent.getExtensions") return Promise.resolve({ extensions: [] });
      if (method === "agent.getSkills") return Promise.resolve({ skills: [] });
      if (method === "agent.getMcpServers") return Promise.resolve({ servers: [] });
      if (method === "agent.getQueue") return Promise.resolve({ queue: [] });
      if (method === "agent.getLatestAgentChange") return Promise.resolve({ change: null });
      if (method === "agent.getAgents") return Promise.resolve({ agents: [] });
      if (method === "agent.getCurrentAgent") return Promise.resolve({ agent: null });
      if (method === "agent.getTierModels") return Promise.resolve({});
      if (method === "project.getModelFavorites") return Promise.resolve({ favorites: [] });
      if (method === "project.getAgentFavorites") return Promise.resolve({ favorites: [] });
      if (method === "session.loadTierConfig") return Promise.resolve(null);
      return Promise.resolve({});
    });

    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: TAB_A.id,
      activeSessionId: null,
      sessionsByProject: { [TAB_A.path]: [session] },
      projectStartFailed: { [TAB_A.id]: false },
      projectStartError: { [TAB_A.id]: "" },
      sessionReady: {},
      agentReady: {},
    });

    useSessionStore.getState().setActiveSession("sess-1", true);
    useSessionStore.getState().setActiveSession("sess-1", true);

    await vi.waitFor(() => {
      const state = useSessionStore.getState();
      expect(state.agentReady["sess-1"]).toBe(true);
      expect(state.projectStartFailed[TAB_A.id]).toBe(false);
    });

    await vi.advanceTimersByTimeAsync(31_000);

    const state = useSessionStore.getState();
    expect(state.agentReady["sess-1"]).toBe(true);
    expect(state.sessionReady["sess-1"]).toBe(true);
    expect(state.projectStartFailed[TAB_A.id]).toBe(false);
    expect(state.projectStartError[TAB_A.id]).toBe("");

    vi.useRealTimers();
  });
});

describe("loadSessionsForProject", () => {
  it("loads sessions from API and stores them", async () => {
    const sessions = [makeSession()];
    mockedCall.mockResolvedValueOnce({ sessions });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toEqual(sessions);
    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toEqual(sessions);
    expect(useSessionStore.getState().loading).toBe(false);
  });

  it("returns empty array on error", async () => {
    mockedCall.mockRejectedValueOnce(new Error("fail"));

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toEqual([]);
    expect(useSessionStore.getState().loading).toBe(false);
  });

  it("cleans up duplicate blank sessions keeping the newest one", async () => {
    const blank1 = makeSession({
      sessionId: "blank-1",
      messageCount: 0,
      firstMessage: "",
      createdAt: 1000,
    });
    const blank2 = makeSession({
      sessionId: "blank-2",
      messageCount: 0,
      firstMessage: "",
      createdAt: 2000,
    });
    const usedSession = makeSession({
      sessionId: "used-1",
      messageCount: 5,
      firstMessage: "hello",
    });
    mockedCall.mockResolvedValueOnce({ sessions: [blank1, usedSession, blank2] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    const stored = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(stored).toHaveLength(2);
    expect(stored.find((s) => s.sessionId === "blank-1")).toBeUndefined();
    expect(stored.find((s) => s.sessionId === "blank-2")).toBeDefined();
    expect(stored.find((s) => s.sessionId === "used-1")).toBeDefined();
    expect(mockedCall).toHaveBeenCalledWith(
      "session.delete",
      expect.objectContaining({ sessionId: "blank-1" }),
    );
  });

  it("does not clean up single blank session", async () => {
    const blank = makeSession({ sessionId: "blank-1", messageCount: 0, firstMessage: "" });
    mockedCall.mockResolvedValueOnce({ sessions: [blank] });

    await useSessionStore.getState().loadSessionsForProject("/project-a");

    const stored = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe("blank-1");
  });
});

describe("createNewSession", () => {
  it("creates a session via API and adds to store", async () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.setState({ activeProjectId: "tab-a" });

    mockedCall.mockResolvedValueOnce({
      sessionId: "new-sess",
      sessionPath: "/sessions/new-sess",
    });

    await useSessionStore.getState().createNewSession();

    const state = useSessionStore.getState();
    const sessions = state.sessionsByProject["/project-a"];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("new-sess");
  });

  it("does not switch tier before the new session agent process is started", async () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.setState({ activeProjectId: "tab-a" });
    useTierStore.getState().setProjectCurrentTier("/project-a", "fast");

    mockedCall.mockResolvedValueOnce({
      sessionId: "new-sess",
      sessionPath: "/sessions/new-sess",
    });

    await useSessionStore.getState().createNewSession();

    expect(mockedCall).toHaveBeenCalledWith("session.create", { projectPath: "/project-a" });
    expect(mockedCall).not.toHaveBeenCalledWith(
      "agent.switchTier",
      expect.objectContaining({ sessionId: "new-sess", tier: "fast" }),
    );
  });

  it("creates a session under the explicit project path instead of the active tab path", async () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.setState({ activeProjectId: "tab-a" });

    mockedCall.mockResolvedValueOnce({
      sessionId: "new-worktree-sess",
      sessionPath: "/sessions/new-worktree-sess",
    });

    await useSessionStore.getState().createNewSession("/worktree-a");

    expect(mockedCall).toHaveBeenCalledWith("session.create", { projectPath: "/worktree-a" });
    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toBeUndefined();
    expect(useSessionStore.getState().sessionsByProject["/worktree-a"]).toEqual([
      expect.objectContaining({
        sessionId: "new-worktree-sess",
        projectPath: "/worktree-a",
      }),
    ]);
    expect(useSessionStore.getState().activeSessionId).toBe("new-worktree-sess");

    await Promise.resolve();
    await Promise.resolve();
    expect(mockedCall).toHaveBeenCalledWith(
      "agent.start",
      expect.objectContaining({
        sessionId: "new-worktree-sess",
        projectPath: "/worktree-a",
        sessionPath: "/sessions/new-worktree-sess",
      }),
    );
  });

  it("handles API error gracefully", async () => {
    useSessionStore.getState().addProjectTab(TAB_A);
    useSessionStore.setState({ activeProjectId: "tab-a" });
    mockedCall.mockRejectedValueOnce(new Error("create fail"));

    await useSessionStore.getState().createNewSession();

    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toBeUndefined();
  });

  it("reuses existing blank session instead of creating a new one", async () => {
    const blankSession = makeSession({ sessionId: "blank-1", messageCount: 0, firstMessage: "" });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      sessionsByProject: { "/project-a": [blankSession] },
    });

    await useSessionStore.getState().createNewSession();

    expect(mockedCall).not.toHaveBeenCalledWith("session.create", expect.anything());
    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toHaveLength(1);
    expect(useSessionStore.getState().activeSessionId).toBe("blank-1");
  });

  it("creates new session when existing sessions have messages", async () => {
    const usedSession = makeSession({
      sessionId: "used-1",
      messageCount: 3,
      firstMessage: "hello",
    });
    useSessionStore.setState({
      projectTabs: [TAB_A],
      activeProjectId: "tab-a",
      sessionsByProject: { "/project-a": [usedSession] },
    });
    mockedCall.mockResolvedValueOnce({
      sessionId: "new-sess",
      sessionPath: "/sessions/new-sess",
    });

    await useSessionStore.getState().createNewSession();

    expect(mockedCall).toHaveBeenCalledWith(
      "session.create",
      expect.objectContaining({ projectPath: "/project-a" }),
    );
    expect(useSessionStore.getState().sessionsByProject["/project-a"]).toHaveLength(2);
  });
});

describe("deleteSession", () => {
  it("removes session from store and clears activeSessionId if active", () => {
    const session = makeSession({ sessionId: "to-delete" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
      activeSessionId: "to-delete",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSessionStore.getState().deleteSession("to-delete");

    const state = useSessionStore.getState();
    expect(state.sessionsByProject["/project-a"]).toHaveLength(0);
    expect(state.activeSessionId).toBeNull();
  });

  it("does not change activeSessionId when deleting a different session", () => {
    useSessionStore.setState({
      sessionsByProject: {
        "/project-a": [makeSession({ sessionId: "sess-1" }), makeSession({ sessionId: "sess-2" })],
      },
      activeSessionId: "sess-1",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSessionStore.getState().deleteSession("sess-2");

    expect(useSessionStore.getState().activeSessionId).toBe("sess-1");
  });

  it("switches to next session via setActiveSession when deleting the active session and others remain", async () => {
    const sessA = makeSession({ sessionId: "sess-a" });
    const sessB = makeSession({ sessionId: "sess-b" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [sessA, sessB] },
      activeSessionId: "sess-a",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSessionStore.getState().deleteSession("sess-a");

    const state = useSessionStore.getState();
    expect(state.sessionsByProject["/project-a"]).toHaveLength(1);
    expect(state.sessionsByProject["/project-a"][0].sessionId).toBe("sess-b");
    expect(state.activeSessionId).toBe("sess-b");

    await vi.waitFor(() => {
      expect(setupSubscriptions).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "sess-b",
        expect.objectContaining({ sessionId: "sess-b" }),
      );
    });

    expect(apiClient.call).toHaveBeenCalledWith(
      "agent.start",
      expect.objectContaining({ sessionId: "sess-b" }),
    );
  });

  it("sets activeSessionId to null when deleting the last session in project", () => {
    const session = makeSession({ sessionId: "only-one" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
      activeSessionId: "only-one",
      activeProjectId: "tab-a",
      projectTabs: [TAB_A],
    });

    useSessionStore.getState().deleteSession("only-one");

    expect(useSessionStore.getState().activeSessionId).toBeNull();
  });
});

describe("setSessionTodos", () => {
  it("sets todos for a session", () => {
    useSessionTodoStore
      .getState()
      .setSessionTodos("sess-1", [{ id: 1, text: "Task 1", done: false }]);
    expect(useSessionTodoStore.getState().todosBySession["sess-1"]).toHaveLength(1);
  });

  it("overwrites existing todos", () => {
    useSessionTodoStore
      .getState()
      .setSessionTodos("sess-1", [{ id: 1, text: "Task 1", done: false }]);
    useSessionTodoStore.getState().setSessionTodos("sess-1", [
      { id: 2, text: "Task 2", done: true },
      { id: 3, text: "Task 3", done: false },
    ]);
    expect(useSessionTodoStore.getState().todosBySession["sess-1"]).toHaveLength(2);
  });
});

describe("updateSessionContext", () => {
  it("sets context for a session", () => {
    useSessionStore
      .getState()
      .updateSessionContext("sess-1", { tokens: 1000, contextWindow: 200000 });
    const ctx = useSessionStore.getState().sessionContextMap["sess-1"];
    expect(ctx.tokens).toBe(1000);
    expect(ctx.contextWindow).toBe(200000);
  });

  it("merges partial updates", () => {
    useSessionStore
      .getState()
      .updateSessionContext("sess-1", { tokens: 1000, contextWindow: 200000 });
    useSessionStore.getState().updateSessionContext("sess-1", { tokens: 2000 });
    const ctx = useSessionStore.getState().sessionContextMap["sess-1"];
    expect(ctx.tokens).toBe(2000);
    expect(ctx.contextWindow).toBe(200000);
  });
});

describe("updateSessionStatus", () => {
  it("sets session status", () => {
    useSessionStore.getState().updateSessionStatus("sess-1", "streaming");
    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("streaming");
  });

  it("updates status independently per session", () => {
    useSessionStore.getState().updateSessionStatus("sess-1", "idle");
    useSessionStore.getState().updateSessionStatus("sess-2", "compacting");
    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("idle");
    expect(useSessionStore.getState().sessionStatusMap["sess-2"]).toBe("compacting");
  });
});

describe("setCurrentModel / setThinkingLevel", () => {
  it("sets current model", () => {
    useSessionStore.getState().setCurrentModel("anthropic", "claude-4");
    expect(useSessionStore.getState().currentModel).toEqual({
      provider: "anthropic",
      id: "claude-4",
    });
  });

  it("sets thinking level", () => {
    useSessionStore.getState().setThinkingLevel("high");
    expect(useSessionStore.getState().currentThinkingLevel).toBe("high");
  });
});

describe("renameSession", () => {
  it("updates session name in store and calls API", () => {
    const session = makeSession({ sessionId: "sess-1", sessionPath: "/s/1" });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().renameSession("sess-1", "My Session");

    const updated = useSessionStore.getState().sessionsByProject["/project-a"];
    expect(updated[0].name).toBe("My Session");
    expect(mockedCall).toHaveBeenCalledWith(
      "session.rename",
      expect.objectContaining({ newName: "My Session" }),
    );
  });
});

describe("togglePinSession", () => {
  it("toggles pinned state and calls correct API", () => {
    const session = makeSession({ sessionId: "sess-1", pinned: false });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [session] },
    });

    useSessionStore.getState().togglePinSession("sess-1");
    expect(useSessionStore.getState().sessionsByProject["/project-a"][0].pinned).toBe(true);
    expect(mockedCall).toHaveBeenCalledWith("session.pin", { sessionId: "sess-1" });

    useSessionStore.getState().togglePinSession("sess-1");
    expect(useSessionStore.getState().sessionsByProject["/project-a"][0].pinned).toBe(false);
    expect(mockedCall).toHaveBeenCalledWith("session.unpin", { sessionId: "sess-1" });
  });
});

describe("updateSessionProjectPath", () => {
  it("updates projectPath for a session", () => {
    const session = makeSession({ sessionId: "sess-1", sessionPath: "/s/1", projectPath: "/old" });
    useSessionStore.setState({
      sessionsByProject: { "/old": [session] },
    });

    useSessionStore.getState().updateSessionProjectPath("sess-1", "/new");

    let found = false;
    for (const sessions of Object.values(useSessionStore.getState().sessionsByProject)) {
      const s = sessions.find((x) => x.sessionId === "sess-1");
      if (s) {
        found = true;
        expect(s.projectPath).toBe("/new");
      }
    }
    expect(found).toBe(true);
  });
});
