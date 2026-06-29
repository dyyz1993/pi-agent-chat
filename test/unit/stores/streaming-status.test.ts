import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: vi.fn(() => ({ activeSubsessionId: null })) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      addEvent: vi.fn(),
      addInjected: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: (raw: Record<string, unknown>) => ({
    id: raw.id ?? `msg-${Date.now()}`,
    role: raw.role ?? "user",
    content: raw.content ?? [{ type: "text", text: raw.content ?? "" }],
    timestamp: raw.timestamp ?? Date.now(),
  }),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  useTierStore: {
    getState: () => ({
      getCurrentTier: vi.fn(() => null),
      getTierModels: vi.fn(() => ({})),
      fetchTierConfig: vi.fn(() => Promise.resolve()),
      syncTierFromModel: vi.fn(),
      switchToTier: vi.fn(),
      setGlobalDefaults: vi.fn(),
      setProjectTierModels: vi.fn(),
      setProjectCurrentTier: vi.fn(),
      dataBySession: {},
      globalDefaults: {},
    }),
  },
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
    getState: () => ({
      setPlugins: vi.fn(),
      setSkills: vi.fn(),
      setMcpServers: vi.fn(),
      setProjectTrustState: vi.fn(),
      applyPermissionProfileSnapshot: vi.fn(),
    }),
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

import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    pendingImages: [],
  });
  useSessionStore.setState({
    sessionsByProject: {},
    activeSessionId: "sess-1",
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
    sessionReady: { "sess-1": true },
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

describe("Scenario 1: sendMessage should update sessionStatusMap to streaming", () => {
  it("calls updateSessionStatus with ('sess-1', 'streaming') when sendMessage is invoked", async () => {
    useChatStore.setState({ inputText: "hello" });
    const statusSpy = vi.spyOn(useSessionStore.getState(), "updateSessionStatus");
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await useChatStore.getState().sendMessage();

    expect(statusSpy).toHaveBeenCalledWith("sess-1", "streaming");
  });
});

describe("Scenario 2: sendMessage failure keeps last runtime status", () => {
  it("does not force status back to idle when apiClient.call rejects", async () => {
    useChatStore.setState({ inputText: "hello" });
    const statusSpy = vi.spyOn(useSessionStore.getState(), "updateSessionStatus");
    (apiClient.call as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network error"));

    await useChatStore.getState().sendMessage();

    expect(statusSpy).toHaveBeenCalledWith("sess-1", "streaming");
    expect(statusSpy).not.toHaveBeenCalledWith("sess-1", "idle");
  });
});

describe("Scenario 3: fetchInitialState should not overwrite non-idle status", () => {
  it("preserves 'streaming' status when agent.getState returns isStreaming=false", async () => {
    useSessionStore.setState({
      sessionStatusMap: { "sess-1": "streaming" },
    });
    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
      if (method === "agent.getState") {
        return Promise.resolve({
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
        });
      }
      if (method === "agent.getAvailableModels") return Promise.resolve([]);
      if (method === "agent.getContextUsage")
        return Promise.resolve({ tokens: null, contextWindow: 0 });
      if (method === "agent.getSettings") return Promise.resolve(null);
      if (method === "agent.getExtensions") return Promise.resolve([]);
      if (method === "agent.getSkills") return Promise.resolve([]);
      if (method === "agent.getDisabledSkills") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const promise = useSessionStore.getState().fetchInitialState("sess-1");
    await promise;
    await vi.waitFor(() => {
      expect(useSessionStore.getState().sessionStatusMap["sess-1"]).toBe("streaming");
    });
  });
});
