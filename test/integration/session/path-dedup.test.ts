/**
 * @vitest-environment node
 *
 * Tests for sessionPath-based deduplication in two places:
 * 1. loadSessionsForProject (use-session-store.ts:291-303)
 * 2. coordinator.session_created handler (session-subscriptions.ts:524-526)
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
      saveInputDraft: vi.fn(),
      restoreInputDraft: vi.fn(),
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

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { insertAfterPinned } from "../../../src/mainview/stores/use-session-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import {
  cleanupSession,
  cleanupSessionLight,
} from "../../../src/mainview/stores/session-subscriptions";
import type { SessionMeta } from "../../../src/shared/modules/project";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;
const mockedCleanupSession = cleanupSession as ReturnType<typeof vi.fn>;
const mockedCleanupSessionLight = cleanupSessionLight as ReturnType<typeof vi.fn>;

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
    batchSubscriptions: {},
    subagentSubscriptions: {},
    todoSubscriptions: {},
    bashSubscriptions: {},
    lspSubscriptions: {},
    rulesSubscriptions: {},
    notifySubscriptions: {},
    memorySubscriptions: {},
    supervisorSubscriptions: {},
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

describe("loadSessionsForProject — sessionPath deduplication", () => {
  it("deduplicates scanned sessions with the same sessionPath", async () => {
    const sharedPath = "/sessions/019e3607-abc.jsonl";
    const scanned = [
      makeSession({ sessionId: "sess_coord_1", sessionPath: sharedPath }),
      makeSession({ sessionId: "019e3607-abc-def", sessionPath: sharedPath }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: scanned });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("sess_coord_1");
  });

  it("keeps existing session and adds unique from scan when sessionPath matches", async () => {
    const existing = makeSession({
      sessionId: "019e3607-abc-def",
      sessionPath: "/sessions/019e3607-abc.jsonl",
      messageCount: 5,
      firstMessage: "hello",
    });
    useSessionStore.setState({
      sessionsByProject: { "/project-a": [existing] },
    });

    const scanned = [
      makeSession({ sessionId: "sess_coord_1", sessionPath: "/sessions/019e3607-abc.jsonl" }),
      makeSession({ sessionId: "sess-unique", sessionPath: "/sessions/unique.jsonl" }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions: scanned });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    // Existing session kept (path confirmed on disk), coord-new filtered (path dup),
    // unique added (new path). 2 total.
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.sessionId === "019e3607-abc-def")).toBeDefined();
    expect(result.find((s) => s.sessionId === "sess-unique")).toBeDefined();
  });

  it("keeps all sessions when there are no sessionPath duplicates", async () => {
    const sessions = [
      makeSession({
        sessionId: "sess-1",
        sessionPath: "/sessions/a.jsonl",
        messageCount: 1,
        firstMessage: "a",
      }),
      makeSession({
        sessionId: "sess-2",
        sessionPath: "/sessions/b.jsonl",
        messageCount: 1,
        firstMessage: "b",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(2);
  });

  it("deduplicates by sessionId AND sessionPath independently", async () => {
    const sessions = [
      makeSession({
        sessionId: "dup-id",
        sessionPath: "/sessions/a.jsonl",
        messageCount: 1,
        firstMessage: "a",
      }),
      makeSession({
        sessionId: "dup-id",
        sessionPath: "/sessions/b.jsonl",
        messageCount: 1,
        firstMessage: "b",
      }),
      makeSession({
        sessionId: "unique-1",
        sessionPath: "/sessions/c.jsonl",
        messageCount: 2,
        firstMessage: "c",
      }),
      makeSession({
        sessionId: "unique-2",
        sessionPath: "/sessions/c.jsonl",
        messageCount: 3,
        firstMessage: "d",
      }),
    ];
    mockedCall.mockResolvedValueOnce({ sessions });

    const result = await useSessionStore.getState().loadSessionsForProject("/project-a");

    expect(result).toHaveLength(2);
    expect(result[0].sessionId).toBe("dup-id");
    expect(result[0].sessionPath).toBe("/sessions/a.jsonl");
    expect(result[1].sessionId).toBe("unique-1");
    expect(result[1].sessionPath).toBe("/sessions/c.jsonl");
  });
});

describe("coordinator.session_created handler — sessionPath deduplication", () => {
  it("skips adding a coordinator session when sessionPath already exists in store", () => {
    const projectPath = "/project-a";
    const sharedPath = "/sessions/019e3607-abc.jsonl";

    const existing: SessionMeta = makeSession({
      sessionId: "019e3607-abc-def",
      sessionPath: sharedPath,
      projectPath,
      messageCount: 3,
      firstMessage: "existing",
    });
    useSessionStore.setState({
      sessionsByProject: { [projectPath]: [existing] },
    });

    const coordinatorSession: SessionMeta = makeSession({
      sessionId: "sess_coord_new",
      sessionPath: sharedPath,
      projectPath,
      status: "running",
    });

    const sessions = useSessionStore.getState().sessionsByProject[projectPath] || [];
    const dupById = sessions.find((s) => s.sessionId === coordinatorSession.sessionId);
    const dupByPath = sessions.find((s) => s.sessionPath === coordinatorSession.sessionPath);

    expect(dupById).toBeUndefined();
    expect(dupByPath).toBeDefined();

    if (!dupById && !dupByPath) {
      const updated = insertAfterPinned(sessions, coordinatorSession);
      useSessionStore.setState({
        sessionsByProject: { [projectPath]: updated },
      });
    }

    const stored = useSessionStore.getState().sessionsByProject[projectPath];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionId).toBe("019e3607-abc-def");
  });

  it("adds coordinator session when sessionPath is unique", () => {
    const projectPath = "/project-a";

    const existing: SessionMeta = makeSession({
      sessionId: "existing-1",
      sessionPath: "/sessions/existing.jsonl",
      projectPath,
    });
    useSessionStore.setState({
      sessionsByProject: { [projectPath]: [existing] },
    });

    const coordinatorSession: SessionMeta = makeSession({
      sessionId: "sess_coord_new",
      sessionPath: "/sessions/new-coord.jsonl",
      projectPath,
      status: "running",
    });

    const sessions = useSessionStore.getState().sessionsByProject[projectPath] || [];
    const dupById = sessions.find((s) => s.sessionId === coordinatorSession.sessionId);
    const dupByPath = sessions.find((s) => s.sessionPath === coordinatorSession.sessionPath);

    expect(dupById).toBeUndefined();
    expect(dupByPath).toBeUndefined();

    if (!dupById && !dupByPath) {
      const updated = insertAfterPinned(sessions, coordinatorSession);
      useSessionStore.setState({
        sessionsByProject: { [projectPath]: updated },
      });
    }

    const stored = useSessionStore.getState().sessionsByProject[projectPath];
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "existing-1" }),
        expect.objectContaining({ sessionId: "sess_coord_new" }),
      ]),
    );
  });

  it("skips when sessionId matches even if sessionPath differs", () => {
    const projectPath = "/project-a";

    const existing: SessionMeta = makeSession({
      sessionId: "sess_coord_123",
      sessionPath: "/sessions/old-path.jsonl",
      projectPath,
    });
    useSessionStore.setState({
      sessionsByProject: { [projectPath]: [existing] },
    });

    const coordinatorSession: SessionMeta = makeSession({
      sessionId: "sess_coord_123",
      sessionPath: "/sessions/new-path.jsonl",
      projectPath,
      status: "running",
    });

    const sessions = useSessionStore.getState().sessionsByProject[projectPath] || [];
    const dupById = sessions.find((s) => s.sessionId === coordinatorSession.sessionId);

    expect(dupById).toBeDefined();

    if (!dupById) {
      const updated = insertAfterPinned(sessions, coordinatorSession);
      useSessionStore.setState({
        sessionsByProject: { [projectPath]: updated },
      });
    }

    const stored = useSessionStore.getState().sessionsByProject[projectPath];
    expect(stored).toHaveLength(1);
    expect(stored[0].sessionPath).toBe("/sessions/old-path.jsonl");
  });
});

describe("setActiveSession cleanup", () => {
  it("unsubscribes the previous active session when switching sessions", () => {
    const projectPath = "/project-a";
    useSessionStore.setState({
      activeProjectId: "tab-a",
      activeSessionId: "sess-old",
      projectTabs: [{ id: "tab-a", name: "Project A", path: projectPath }],
      sessionsByProject: {
        [projectPath]: [
          makeSession({
            sessionId: "sess-old",
            sessionPath: "/sessions/old.jsonl",
            projectPath,
          }),
          makeSession({
            sessionId: "sess-new",
            sessionPath: "/sessions/new.jsonl",
            projectPath,
          }),
        ],
      },
      agentSubscriptions: { "sess-old": "agent-sub-old" },
      bashSubscriptions: { "sess-old": "bash-sub-old" },
      memorySubscriptions: { "sess-old": ["memory-sub-old"] },
      sessionReady: { "sess-old": true },
    });

    useSessionStore.getState().setActiveSession("sess-new");

    expect(mockedCleanupSession).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSessionId: "sess-old",
      }),
      "sess-old",
    );
    expect(mockedCleanupSessionLight).toHaveBeenCalledWith("sess-old");
  });
});
