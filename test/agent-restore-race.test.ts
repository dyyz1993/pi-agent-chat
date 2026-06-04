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

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
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

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn() })),
  },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: {
    getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: {
    getState: vi.fn(() => ({ clearSessionUI: vi.fn() })),
  },
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

vi.mock("../src/mainview/stores/use-retry-store", () => ({
  useRetryConfigStore: {
    getState: vi.fn(() => ({ setRetryConfig: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: vi.fn(() => ({
      syncTierFromModel: vi.fn(),
      setSessionCurrentTier: vi.fn(),
      setGlobalDefaults: vi.fn(),
      setSessionTierModels: vi.fn(),
      getCurrentTier: vi.fn(() => null),
      getTierModels: vi.fn(() => ({})),
      dataBySession: {},
      globalDefaults: {},
    })),
  },
}));

import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useAgentStore } from "../src/mainview/stores/use-agent-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockedCall = vi.mocked(apiClient.call);

// Each test uses a unique session ID to avoid the module-level _fetchInitPromiseMap dedup
let SID: string;
let testCounter = 0;

const AGENTS_RESPONSE = {
  agents: [
    { name: "build", description: "Build agent", source: "builtin" },
    { name: "plan", description: "Plan agent", source: "builtin" },
    { name: "pi-expert", description: "Expert agent", source: "user" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  testCounter++;
  SID = `sess-agent-restore-${testCounter}`;
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
  useAgentStore.setState({
    currentAgentBySession: {},
    agents: [],
    switchingBySession: {},
    agentDetailBySession: {},
    allToolsBySession: {},
    liveSystemPromptBySession: {},
    loadingDetail: false,
    loaded: false,
  });
});

function baseMocks(overrides?: Record<string, () => unknown>) {
  const defaults: Record<string, () => unknown> = {
    "agent.getState": () => ({
      model: { provider: "test", id: "m1", name: "Test", contextWindow: 200000 },
      thinkingLevel: "medium",
      isStreaming: false,
      isCompacting: false,
    }),
    "agent.getAvailableModels": () => [],
    "agent.getExtensions": () => [],
    "agent.getSkills": () => [],
    "agent.getDisabledSkills": () => ({ disabledSkills: [] }),
    "agent.getQueue": () => ({ steering: [], followUp: [] }),
    "agent.getMcpServers": () => ({ servers: [] }),
    "agent.getSettings": () => null,
    "agent.getTierModels": () => ({ models: {} }),
    "project.getModelFavorites": () => ({ favorites: [] }),
    "agent.getContextUsage": () => ({ tokens: 1000, contextWindow: 200000 }),
    "agent.getAgents": () => AGENTS_RESPONSE,
    "agent.getCurrentAgent": () => ({ agentName: "build" }),
    "agent.getLatestAgentChange": () => null,
    "agent.switchAgent": () => ({ agentName: "build", tools: [] }),
    "agent.getAgentDetail": () => ({ agent: { name: "build", description: "Build" } }),
    "agent.getAllTools": () => ({ tools: [] }),
    "agent.getSystemPrompt": () => ({ systemPrompt: "" }),
  };
  const merged = { ...defaults, ...overrides };
  mockedCall.mockImplementation((method: string) => {
    const handler = merged[method];
    if (handler) return Promise.resolve(handler());
    return Promise.resolve({});
  });
}

describe("fetchInitialState agent restoration", () => {
  it("restores agent from getLatestAgentChange", async () => {
    baseMocks({
      "agent.getLatestAgentChange": () => ({
        agentName: "plan",
        timestamp: "2026-05-20T05:00:00.000Z",
      }),
      "agent.switchAgent": () => ({ agentName: "plan", tools: [] }),
      "agent.getAgentDetail": () => ({ agent: { name: "plan", description: "Plan" } }),
    });

    useSessionStore.getState().fetchInitialState(SID);
    await new Promise((r) => setTimeout(r, 1500));

    const restoredAgent = useAgentStore.getState().currentAgentBySession[SID];
    expect(restoredAgent).toBe("plan");
  });

  it("FIXED: agent restored correctly even when currentAgentPromise resolves after agentChangePromise", async () => {
    // Control resolve order: agentChange resolves first, currentAgent resolves last.
    // With Promise.all fix, processing order is guaranteed:
    //   1. agents  2. currentAgent  3. agentChange (override)
    let resolveCurrentAgent: (value: unknown) => void;
    let resolveAgentChange: (value: unknown) => void;

    const currentAgentPromise = new Promise((resolve) => {
      resolveCurrentAgent = resolve;
    });
    const agentChangePromise = new Promise((resolve) => {
      resolveAgentChange = resolve;
    });

    baseMocks({
      "agent.getCurrentAgent": () => currentAgentPromise,
      "agent.getLatestAgentChange": () => agentChangePromise,
      "agent.switchAgent": () => ({ agentName: "pi-expert", tools: [] }),
      "agent.getAgentDetail": () => ({ agent: { name: "pi-expert", description: "Expert" } }),
    });

    useSessionStore.getState().fetchInitialState(SID);

    // Resolve agentChange first (simulates fast JSONL scan)
    resolveAgentChange!({
      agentName: "pi-expert",
      timestamp: "2026-05-20T05:43:26.591Z",
    });
    await new Promise((r) => setTimeout(r, 50));

    // Now resolve currentAgent last (simulates slow IPC)
    resolveCurrentAgent!({ agentName: "build" });
    await new Promise((r) => setTimeout(r, 500));

    // With Promise.all fix:
    // - Step 1: setAgents (from agentsPromise, resolved immediately)
    // - Step 2: setCurrentAgent("build") (from currentAgentPromise)
    // - Step 3: switchAgent("pi-expert") (from agentChangePromise, overrides)
    const finalAgent = useAgentStore.getState().currentAgentBySession[SID];
    expect(finalAgent).toBe("pi-expert");

    // switchAgent should have been called with the persisted agent
    const switchCalls = mockedCall.mock.calls.filter((c) => c[0] === "agent.switchAgent");
    expect(switchCalls.length).toBeGreaterThanOrEqual(1);
    expect((switchCalls[0] as unknown[])[1]).toEqual(
      expect.objectContaining({ agentName: "pi-expert", sessionId: SID }),
    );
  });

  it("uses build as fallback when no agent_change exists", async () => {
    baseMocks();

    useSessionStore.getState().fetchInitialState(SID);
    await new Promise((r) => setTimeout(r, 1500));

    const agent = useAgentStore.getState().currentAgentBySession[SID];
    expect(agent).toBe("build");
  });
});
