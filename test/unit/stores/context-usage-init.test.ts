import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

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
    getState: vi.fn(() => ({
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
    })),
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
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn() })),
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

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    delete (s as Record<string, unknown>).batchSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
}));

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useSupervisorStore } from "../../../src/mainview/stores/use-supervisor-store";
import { useTierStore } from "../../../src/mainview/stores/use-tier-store";

let _sidCounter = 0;
function nextSid() {
  return `sess-ctx-${++_sidCounter}`;
}

function seedSessionProject(
  sessionId: string,
  projectPath = "/tmp/pi-agent-chat-test",
  overrides: Record<string, unknown> = {},
) {
  useSessionStore.setState({
    sessionsByProject: {
      [projectPath]: [
        {
          sessionId,
          name: sessionId,
          createdAt: new Date().toISOString(),
          status: "idle",
          projectPath,
          ...overrides,
        },
      ],
    },
  });
}

const AGENT_STATE = {
  model: { provider: "test", id: "model-1", name: "Test Model", contextWindow: 200000 },
  thinkingLevel: "medium",
  isStreaming: false,
  isCompacting: false,
};

function setupMock(contextUsageHandler: () => Promise<unknown>) {
  const mockFn = apiClient.call as ReturnType<typeof vi.fn>;
  mockFn.mockReset();
  mockFn.mockImplementation((method: string) => {
    if (method === "agent.getState") return Promise.resolve(AGENT_STATE);
    if (method === "agent.getAvailableModels") return Promise.resolve([]);
    if (method === "agent.getExtensions") return Promise.resolve([]);
    if (method === "agent.getSkills") return Promise.resolve([]);
    if (method === "agent.getDisabledSkills") return Promise.resolve({ disabledSkills: [] });
    if (method === "agent.getQueue") return Promise.resolve({ steering: [], followUp: [] });
    if (method === "agent.getContextUsage") return contextUsageHandler();
    if (method === "agent.getSessionStats")
      return Promise.resolve({
        tokens: {
          input: 1000,
          output: 200,
          cacheRead: 300,
          cacheWrite: 100,
          total: 1600,
        },
        cost: 0.0016,
        toolCalls: 2,
        totalMessages: 4,
      });
    if (method === "agent.getTierModels") return Promise.resolve({ models: {} });
    if (method === "agent.switchTier")
      return Promise.resolve({ provider: "test", id: "fast-model", tier: "fast" });
    if (method === "agent.getLatestAgentChange") return Promise.resolve(null);
    if (method === "agent.getAgents") return Promise.resolve([]);
    if (method === "agent.getCurrentAgent") return Promise.resolve(null);
    if (method === "agent.getMcpServers") return Promise.resolve([]);
    if (method === "project.getModelFavorites") return Promise.resolve({ favorites: [] });
    if (method === "project.getAgentFavorites") return Promise.resolve({ favorites: [] });
    if (method === "agent.getSettings") return Promise.resolve({});
    if (method === "supervisor.getStatus")
      return Promise.resolve({
        enabled: true,
        state: "idle",
        continueCount: 0,
        maxContinueCount: 0,
        activeGuards: [],
      });
    return Promise.resolve({});
  });
}

function getContextUsageCalls() {
  return (apiClient.call as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c: unknown[]) => (c as string[])[0] === "agent.getContextUsage",
  );
}

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
    sessionReady: {},
    sessionContextMap: {},
    sessionStatsMap: {},
    sessionStatusMap: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    availableModelsBySession: {},
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    modelManuallySet: false,
    modelFavorites: new Set(),
  });
  useSupervisorStore.setState({ bySession: {} });
  useTierStore.setState({
    globalDefaults: {},
    hasGlobalDefaults: false,
    dataBySession: {},
    switching: false,
  });
});

describe("fetchInitialState context usage retry", () => {
  it("shares startup model and tier fetches with component store entrypoints", async () => {
    const sid = nextSid();
    seedSessionProject(sid);
    setupMock(() => Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 }));

    await Promise.all([
      useSessionStore.getState().fetchInitialState(sid),
      useSessionStore.getState().fetchModelState(sid),
      useTierStore.getState().fetchTierConfig(sid),
    ]);

    const calls = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter(([method]) => method === "agent.getAvailableModels")).toHaveLength(1);
    expect(calls.filter(([method]) => method === "agent.getTierModels")).toHaveLength(1);
  });

  it("applies the configured project tier after startup state is available for blank sessions", async () => {
    const sid = nextSid();
    seedSessionProject(sid);
    useTierStore.getState().setProjectCurrentTier("/tmp/pi-agent-chat-test", "fast");
    setupMock(() => Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 }));

    await useSessionStore.getState().fetchInitialState(sid);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiClient.call).toHaveBeenCalledWith("agent.getState", { sessionId: sid });
    expect(apiClient.call).toHaveBeenCalledWith("agent.switchTier", {
      sessionId: sid,
      tier: "fast",
    });
  });

  it("does not apply project tier when opening a non-empty existing session", async () => {
    const sid = nextSid();
    seedSessionProject(sid, "/tmp/pi-agent-chat-test", {
      messageCount: 3,
      firstMessage: "existing conversation",
    });
    useTierStore.getState().setProjectCurrentTier("/tmp/pi-agent-chat-test", "fast");
    setupMock(() => Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 }));

    await useSessionStore.getState().fetchInitialState(sid);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const calls = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.filter(([method]) => method === "agent.switchTier")).toHaveLength(0);
  });

  it("calls agent.getContextUsage and agent.getSessionStats for startup usage snapshots", async () => {
    const sid = nextSid();
    setupMock(() => Promise.resolve({ tokens: 5000, contextWindow: 200000, percent: 0.025 }));

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 500));

    expect(getContextUsageCalls().length).toBeGreaterThanOrEqual(1);
    const sessionStatsCalls = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => (c as string[])[0] === "agent.getSessionStats",
    );
    expect(sessionStatsCalls).toHaveLength(1);
    expect(useSessionStore.getState().sessionStatsMap[sid]).toMatchObject({
      tokens: {
        input: 1000,
        output: 200,
        cacheRead: 300,
        cacheWrite: 100,
        total: 1600,
      },
      cost: 0.0016,
      toolCalls: 2,
      totalMessages: 4,
    });
  });

  it("succeeds immediately when first call returns valid tokens", async () => {
    const sid = nextSid();
    setupMock(() => Promise.resolve({ tokens: 5000, contextWindow: 200000, percent: 0.025 }));

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 500));

    const ctx = useSessionStore.getState().sessionContextMap[sid];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(5000);
    expect(ctx.contextWindow).toBe(200000);
    expect(getContextUsageCalls()).toHaveLength(1);
  });

  it("retries when first attempt returns null response, second succeeds", async () => {
    const sid = nextSid();
    let callCount = 0;
    setupMock(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(null);
      return Promise.resolve({ tokens: 5000, contextWindow: 200000, percent: 0.025 });
    });

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 2000));

    const ctx = useSessionStore.getState().sessionContextMap[sid];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(5000);
    expect(getContextUsageCalls()).toHaveLength(2);
  });

  it("stops retrying after 3 attempts all return null", { timeout: 10000 }, async () => {
    const sid = nextSid();
    setupMock(() => Promise.resolve(null));

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 6000));

    expect(getContextUsageCalls()).toHaveLength(2);

    const ctx = useSessionStore.getState().sessionContextMap[sid];
    expect(ctx?.tokens == null).toBe(true);
  });

  it("retries when first attempt throws, second succeeds", async () => {
    const sid = nextSid();
    let callCount = 0;
    setupMock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("RPC fail"));
      return Promise.resolve({ tokens: 8000, contextWindow: 200000, percent: 0.04 });
    });

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 2000));

    const ctx = useSessionStore.getState().sessionContextMap[sid];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(8000);
    expect(getContextUsageCalls()).toHaveLength(2);
  });

  it("retries when tokens is null, then succeeds", async () => {
    const sid = nextSid();
    let callCount = 0;
    setupMock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.resolve({ tokens: null, contextWindow: 0, percent: null });
      return Promise.resolve({ tokens: 3000, contextWindow: 200000, percent: 0.015 });
    });

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 2000));

    const ctx = useSessionStore.getState().sessionContextMap[sid];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(3000);
    expect(ctx.contextWindow).toBe(200000);
    expect(getContextUsageCalls()).toHaveLength(2);
  });

  it("updates contextWindow from successful response", async () => {
    const sid = nextSid();
    setupMock(() => Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 }));

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 500));

    const ctx = useSessionStore.getState().sessionContextMap[sid];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(10000);
    expect(ctx.contextWindow).toBe(128000);
  });

  it("hydrates supervisor goal during initial state fetch", async () => {
    const sid = nextSid();
    const goal = {
      id: "goal-1",
      objective: "持续执行，直到满足 spa 爬虫",
      status: "running" as const,
      startedAt: 1780743607505,
      updatedAt: 1780743607505,
      continuationCount: 0,
      blockers: [],
    };
    setupMock(() => Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 }));
    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") return Promise.resolve(AGENT_STATE);
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve({ disabledSkills: [] });
      if (method === "agent.getQueue") return Promise.resolve({ steering: [], followUp: [] });
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 });
      if (method === "agent.getSessionStats")
        return Promise.resolve({
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          cost: 0,
          toolCalls: 0,
          totalMessages: 0,
        });
      if (method === "agent.getTierModels") return Promise.resolve({ models: {} });
      if (method === "agent.getLatestAgentChange") return Promise.resolve(null);
      if (method === "agent.getAgents") return Promise.resolve([]);
      if (method === "agent.getCurrentAgent") return Promise.resolve(null);
      if (method === "agent.getMcpServers") return Promise.resolve([]);
      if (method === "project.getModelFavorites") return Promise.resolve({ favorites: [] });
      if (method === "project.getAgentFavorites") return Promise.resolve({ favorites: [] });
      if (method === "agent.getSettings") return Promise.resolve({});
      if (method === "supervisor.getStatus")
        return Promise.resolve({
          enabled: true,
          state: "idle",
          continueCount: 0,
          maxContinueCount: 0,
          activeGuards: [],
          goal,
        });
      return Promise.resolve({});
    });

    useSessionStore.getState().fetchInitialState(sid);
    await new Promise((r) => setTimeout(r, 500));

    expect(apiClient.call).toHaveBeenCalledWith("supervisor.getStatus", { sessionId: sid });
    expect(useSupervisorStore.getState().bySession[sid]?.status?.goal).toEqual(goal);
  });
});
