/**
 * @vitest-environment node
 *
 * TDD RED phase: Bug 4a — loadSessionsForProject merge discards coordinator sessions
 *
 * Coordinator sessions added via real-time `coordinator.session_created` event
 * have `delegateParentSessionId` set but may NOT appear in the disk scan yet
 * (JSONL not flushed). The current filter logic removes them.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", () => ({
  persist: (fn: unknown) => fn,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
    subscribe: vi.fn().mockResolvedValue("mock-sub-id"),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: vi.fn(() => ({ addEntry: vi.fn() })) },
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
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn() })) },
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
  useTurnStore: { getState: vi.fn(() => ({ clearSessionUI: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: vi.fn(() => ({ clearSessionUI: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-bash-store", () => ({
  useBashStore: { getState: () => ({}) },
  handleBashEvent: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/lib/agent-event-handler", () => ({
  handleAgentEvent: vi.fn(),
  toolCallNameMap: {},
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
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
import type { SessionMeta } from "../../../src/mainview/types";

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
  vi.resetAllMocks();
  mockedCall.mockResolvedValue({});
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
    supervisorSubscriptions: {},
    goalSubscriptions: {},
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

describe("Bug 4a: loadSessionsForProject merge discards coordinator sessions", () => {
  it("preserves coordinator session with delegateParentSessionId not yet on disk", async () => {
    const parentSession = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });

    const coordinatorSession = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      messageCount: 2,
      firstMessage: "doing work",
      delegateParentSessionId: "parent-1",
    });

    useSessionStore.setState({
      sessionsByProject: {
        "/project-a": [parentSession, coordinatorSession],
      },
    });

    mockedCall.mockResolvedValueOnce({
      sessions: [parentSession],
    });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result.find((s) => s.sessionId === "coord-1")).toBeDefined();
    expect(result.find((s) => s.sessionId === "parent-1")).toBeDefined();
    expect(result).toHaveLength(2);
  });

  it("preserves multiple coordinator sessions not yet on disk", async () => {
    const parentSession = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });

    const coord1 = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      messageCount: 2,
      firstMessage: "work 1",
      delegateParentSessionId: "parent-1",
    });

    const coord2 = makeSession({
      sessionId: "coord-2",
      sessionPath: "/s/coord-2.jsonl",
      messageCount: 1,
      firstMessage: "work 2",
      delegateParentSessionId: "parent-1",
    });

    useSessionStore.setState({
      sessionsByProject: {
        "/project-a": [parentSession, coord1, coord2],
      },
    });

    mockedCall.mockResolvedValueOnce({
      sessions: [parentSession],
    });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(3);
    expect(result.find((s) => s.sessionId === "coord-1")).toBeDefined();
    expect(result.find((s) => s.sessionId === "coord-2")).toBeDefined();
    expect(result.find((s) => s.sessionId === "parent-1")).toBeDefined();
  });

  it("removes normal session that disappeared from disk but keeps coordinator", async () => {
    const parentSession = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });

    const normalSession = makeSession({
      sessionId: "normal-1",
      sessionPath: "/s/normal-1.jsonl",
      messageCount: 3,
      firstMessage: "normal work",
    });

    const coordinatorSession = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      messageCount: 2,
      firstMessage: "delegated work",
      delegateParentSessionId: "parent-1",
    });

    useSessionStore.setState({
      sessionsByProject: {
        "/project-a": [parentSession, normalSession, coordinatorSession],
      },
    });

    mockedCall.mockResolvedValueOnce({
      sessions: [parentSession],
    });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result.find((s) => s.sessionId === "normal-1")).toBeUndefined();
    expect(result.find((s) => s.sessionId === "coord-1")).toBeDefined();
    expect(result.find((s) => s.sessionId === "parent-1")).toBeDefined();
    expect(result).toHaveLength(2);
  });

  it("keeps coordinator session once it appears on disk", async () => {
    const parentSession = makeSession({
      sessionId: "parent-1",
      sessionPath: "/s/parent-1.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });

    const coordinatorSession = makeSession({
      sessionId: "coord-1",
      sessionPath: "/s/coord-1.jsonl",
      messageCount: 2,
      firstMessage: "doing work",
      delegateParentSessionId: "parent-1",
    });

    useSessionStore.setState({
      sessionsByProject: {
        "/project-a": [parentSession, coordinatorSession],
      },
    });

    mockedCall.mockResolvedValueOnce({
      sessions: [parentSession, coordinatorSession],
    });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(2);
    expect(result.find((s) => s.sessionId === "coord-1")).toBeDefined();
  });
});
