import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return {
    ...actual,
    persist: (fn: unknown) => fn,
  };
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
  clearSubscriptionState: (s: Record<string, unknown>) => {
    delete (s as Record<string, unknown>).agentSubscriptions;
    return {};
  },
  syncTabsToBackend: vi.fn(),
}));

import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockedCall = vi.mocked(apiClient.call);

const SID = "sess-ctx-1";

const AGENT_STATE = {
  model: { provider: "test", id: "model-1", name: "Test Model", contextWindow: 200000 },
  thinkingLevel: "medium",
  isStreaming: false,
  isCompacting: false,
};

function setupMock(contextUsageHandler: () => Promise<unknown>) {
  mockedCall.mockImplementation((method: string) => {
    if (method === "agent.getState") return Promise.resolve(AGENT_STATE);
    if (method === "agent.getAvailableModels") return Promise.resolve([]);
    if (method === "agent.getExtensions") return Promise.resolve([]);
    if (method === "agent.getSkills") return Promise.resolve([]);
    if (method === "agent.getDisabledSkills") return Promise.resolve({ disabledSkills: [] });
    if (method === "agent.getQueue") return Promise.resolve({ steering: [], followUp: [] });
    if (method === "agent.getContextUsage") return contextUsageHandler();
    return Promise.resolve({});
  });
}

function getContextUsageCalls() {
  return mockedCall.mock.calls.filter((c) => (c as string[])[0] === "agent.getContextUsage");
}

beforeEach(() => {
  vi.useFakeTimers();
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

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchInitialState context usage retry", () => {
  it("calls agent.getContextUsage (not getSessionStats)", async () => {
    setupMock(() => Promise.resolve({ tokens: 5000, contextWindow: 200000, percent: 0.025 }));

    useSessionStore.getState().fetchInitialState(SID);
    await vi.runOnlyPendingTimersAsync();

    expect(getContextUsageCalls().length).toBeGreaterThanOrEqual(1);
    const sessionStatsCalls = mockedCall.mock.calls.filter(
      (c) => (c as string[])[0] === "agent.getSessionStats",
    );
    expect(sessionStatsCalls).toHaveLength(0);
  });

  it("succeeds immediately when first call returns valid tokens", async () => {
    setupMock(() => Promise.resolve({ tokens: 5000, contextWindow: 200000, percent: 0.025 }));

    useSessionStore.getState().fetchInitialState(SID);
    await vi.runOnlyPendingTimersAsync();

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(5000);
    expect(ctx.contextWindow).toBe(200000);
    expect(getContextUsageCalls()).toHaveLength(1);
  });

  it("retries when first attempt returns null response, second succeeds", async () => {
    let callCount = 0;
    setupMock(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(null);
      return Promise.resolve({ tokens: 5000, contextWindow: 200000, percent: 0.025 });
    });

    useSessionStore.getState().fetchInitialState(SID);
    await vi.runOnlyPendingTimersAsync();

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(5000);
    expect(getContextUsageCalls()).toHaveLength(2);
  });

  it("stops retrying after 3 attempts all return null", async () => {
    setupMock(() => Promise.resolve(null));

    useSessionStore.getState().fetchInitialState(SID);

    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(getContextUsageCalls()).toHaveLength(3);

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx?.tokens == null).toBe(true);
  });

  it("retries when first attempt throws, second succeeds", async () => {
    let callCount = 0;
    setupMock(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("RPC fail"));
      return Promise.resolve({ tokens: 8000, contextWindow: 200000, percent: 0.04 });
    });

    useSessionStore.getState().fetchInitialState(SID);
    await vi.runOnlyPendingTimersAsync();

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(8000);
    expect(getContextUsageCalls()).toHaveLength(2);
  });

  it("retries when tokens is null, then succeeds", async () => {
    let callCount = 0;
    setupMock(() => {
      callCount++;
      if (callCount === 1)
        return Promise.resolve({ tokens: null, contextWindow: 0, percent: null });
      return Promise.resolve({ tokens: 3000, contextWindow: 200000, percent: 0.015 });
    });

    useSessionStore.getState().fetchInitialState(SID);
    await vi.runOnlyPendingTimersAsync();

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(3000);
    expect(ctx.contextWindow).toBe(200000);
    expect(getContextUsageCalls()).toHaveLength(2);
  });

  it("updates contextWindow from successful response", async () => {
    setupMock(() => Promise.resolve({ tokens: 10000, contextWindow: 128000, percent: 0.078 }));

    useSessionStore.getState().fetchInitialState(SID);
    await vi.runOnlyPendingTimersAsync();

    const ctx = useSessionStore.getState().sessionContextMap[SID];
    expect(ctx).toBeDefined();
    expect(ctx.tokens).toBe(10000);
    expect(ctx.contextWindow).toBe(128000);
  });
});
