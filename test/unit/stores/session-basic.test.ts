import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectTab, ContextUsage, SessionStatus } from "../../../src/mainview/types";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: () => ({
      getCurrentTier: vi.fn(() => null),
      getTierModels: vi.fn(() => ({})),
      syncTierFromModel: vi.fn(),
      switchToTier: vi.fn(),
      setGlobalDefaults: vi.fn(),
      setSessionTierModels: vi.fn(),
      setSessionCurrentTier: vi.fn(),
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
    getState: () => ({ fetchWorktrees: vi.fn(), fetchStatus: vi.fn(), fetchBranches: vi.fn() }),
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

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => s,
  syncTabsToBackend: vi.fn(),
}));

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSessionTodoStore } from "../../../src/mainview/stores/use-session-todo-store";
import { useSessionQueueStore } from "../../../src/mainview/stores/use-session-queue-store";

describe("useSessionStore - basic state", () => {
  beforeEach(() => {
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
      coordinatorSubscriptions: {},
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

  it("has correct initial state", () => {
    const s = useSessionStore.getState();
    expect(s.activeSessionId).toBeNull();
    expect(s.activeProjectId).toBeNull();
    expect(s.projectTabs).toEqual([]);
    expect(s.loading).toBe(false);
    expect(s.sessionReady).toEqual({});
    expect(s.sessionStatusMap).toEqual({});
    expect(s.sessionContextMap).toEqual({});
    expect(useSessionQueueStore.getState().queueBySession).toEqual({});
    expect(s.currentModel).toBeNull();
    expect(s.currentThinkingLevel).toBe("medium");
    expect(s.availableModels).toEqual([]);
    expect(s.projectStartFailed).toEqual({});
    expect(s.projectStartError).toEqual({});
  });

  it("updateSessionStatus sets status for a session", () => {
    useSessionStore.getState().updateSessionStatus("sess-1", "streaming");
    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("streaming");
  });

  it("updateSessionStatus overwrites previous status", () => {
    useSessionStore.getState().updateSessionStatus("sess-1", "streaming");
    useSessionStore.getState().updateSessionStatus("sess-1", "idle");
    expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("idle");
  });

  it("updateSessionStatus handles multiple sessions independently", () => {
    useSessionStore.getState().updateSessionStatus("s1", "streaming");
    useSessionStore.getState().updateSessionStatus("s2", "compacting");
    const map = useSessionStore.getState().sessionStatusMap;
    expect(map.s1).toBe("streaming");
    expect(map.s2).toBe("compacting");
  });

  it("updateSessionContext sets context for a session", () => {
    const usage: Partial<ContextUsage> = { tokens: 1000, contextWindow: 8000 };
    useSessionStore.getState().updateSessionContext("sess-1", usage);
    const ctx = useSessionStore.getState().sessionContextMap["sess-1"];
    expect(ctx.tokens).toBe(1000);
    expect(ctx.contextWindow).toBe(8000);
  });

  it("updateSessionContext merges partial updates", () => {
    useSessionStore.getState().updateSessionContext("sess-1", { contextWindow: 8000 });
    useSessionStore.getState().updateSessionContext("sess-1", { tokens: 500 });
    const ctx = useSessionStore.getState().sessionContextMap["sess-1"];
    expect(ctx.tokens).toBe(500);
    expect(ctx.contextWindow).toBe(8000);
  });

  it("updateSessionContext defaults tokens to null when no previous context", () => {
    useSessionStore.getState().updateSessionContext("fresh", { contextWindow: 16000 });
    const ctx = useSessionStore.getState().sessionContextMap.fresh;
    expect(ctx.tokens).toBeNull();
    expect(ctx.contextWindow).toBe(16000);
  });

  it("setSessionTodos stores todos by session id", () => {
    const todos = [
      { id: 1, text: "Task A", done: false },
      { id: 2, text: "Task B", done: true },
    ];
    useSessionTodoStore.getState().setSessionTodos("s1", todos);
    expect(useSessionTodoStore.getState().todosBySession.s1).toEqual(todos);
  });

  it("setSessionTodos overwrites previous todos", () => {
    useSessionTodoStore.getState().setSessionTodos("s1", [{ id: 1, text: "Old", done: false }]);
    useSessionTodoStore.getState().setSessionTodos("s1", [{ id: 2, text: "New", done: true }]);
    expect(useSessionTodoStore.getState().todosBySession.s1).toEqual([
      { id: 2, text: "New", done: true },
    ]);
  });

  it("setCurrentModel updates currentModel", () => {
    useSessionStore.getState().setCurrentModel("openai", "gpt-4");
    const m = useSessionStore.getState().currentModel;
    expect(m).not.toBeNull();
    expect(m!.provider).toBe("openai");
    expect(m!.id).toBe("gpt-4");
  });

  it("setThinkingLevel updates thinking level", () => {
    useSessionStore.getState().setThinkingLevel("high");
    expect(useSessionStore.getState().currentThinkingLevel).toBe("high");
  });

  it("addProjectTab adds tab and sets activeProjectId", () => {
    const tab: ProjectTab = { id: "tab-1", name: "Project A", path: "/tmp/a" };
    useSessionStore.getState().addProjectTab(tab);
    const s = useSessionStore.getState();
    expect(s.projectTabs).toHaveLength(1);
    expect(s.projectTabs[0].id).toBe("tab-1");
    expect(s.activeProjectId).toBe("tab-1");
  });

  it("addProjectTab with existing path sets activeProjectId without duplicate", () => {
    const tab: ProjectTab = { id: "tab-1", name: "Project A", path: "/tmp/a" };
    useSessionStore.getState().addProjectTab(tab);
    const dup: ProjectTab = { id: "tab-2", name: "Project A Copy", path: "/tmp/a" };
    useSessionStore.getState().addProjectTab(dup);
    const s = useSessionStore.getState();
    expect(s.projectTabs).toHaveLength(1);
    expect(s.activeProjectId).toBe("tab-1");
  });

  it("reorderProjectTabs changes tab order", () => {
    useSessionStore.setState({
      projectTabs: [
        { id: "t1", name: "A", path: "/a" },
        { id: "t2", name: "B", path: "/b" },
        { id: "t3", name: "C", path: "/c" },
      ],
      activeProjectId: "t1",
    });
    useSessionStore.getState().reorderProjectTabs(0, 2);
    const tabs = useSessionStore.getState().projectTabs;
    expect(tabs.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("queueBySession can be set via setState", () => {
    useSessionQueueStore.setState({
      queueBySession: { s1: { steering: ["msg-1"], followUp: [] } },
    });
    const q = useSessionQueueStore.getState().queueBySession;
    expect(q.s1.steering).toEqual(["msg-1"]);
    expect(q.s1.followUp).toEqual([]);
  });

  it("sessionReady can be set per session", () => {
    useSessionStore.setState({ sessionReady: { s1: true } });
    expect(useSessionStore.getState().sessionReady.s1).toBe(true);
    expect(useSessionStore.getState().sessionReady.s2).toBeUndefined();
  });

  it("projectStartFailed tracks failure state", () => {
    useSessionStore.setState({
      projectStartFailed: { "proj-1": true },
      projectStartError: { "proj-1": "timeout" },
    });
    const s = useSessionStore.getState();
    expect(s.projectStartFailed["proj-1"]).toBe(true);
    expect(s.projectStartError["proj-1"]).toBe("timeout");
  });

  it("availableModels can be set", () => {
    const models = [
      { provider: "openai", id: "gpt-4", name: "GPT-4", contextWindow: 128000, reasoning: false },
    ];
    useSessionStore.setState({ availableModels: models });
    expect(useSessionStore.getState().availableModels).toHaveLength(1);
    expect(useSessionStore.getState().availableModels[0].id).toBe("gpt-4");
  });

  it("updateSessionStatus accepts all valid statuses", () => {
    const statuses: SessionStatus[] = ["idle", "streaming", "compacting", "permission", "retrying"];
    for (const status of statuses) {
      useSessionStore.getState().updateSessionStatus("s1", status);
      expect(useSessionStore.getState().sessionStatusMap.s1).toBe(status);
    }
  });
});
