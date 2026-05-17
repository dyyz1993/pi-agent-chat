/**
 * @vitest-environment node
 *
 * TDD 测试：验证 coordinator.session_created 前端 handler 的完整性。
 *
 * 当前行为：handler 只把 session meta 添加到 sessionsByProject
 *
 * 缺失行为（会导致"会话出现但不可用"）：
 * 1. 没有订阅 coordinator.session.event（子会话消息流丢失）
 * 2. 没有为新会话 setupSubscriptions（agent event / bash / todo 全缺）
 * 3. 没有加载初始消息
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Zustand stores
const mockSessionStoreState: Record<string, unknown> = {
  sessionsByProject: {},
  coordinatorSubscriptions: {},
  agentSubscriptions: {},
  subagentSubscriptions: {},
  todoSubscriptions: {},
  bashSubscriptions: {},
  lspSubscriptions: {},
  rulesSubscriptions: {},
  notifySubscriptions: {},
  memorySubscriptions: {},
  supervisorSubscriptions: {},
  sessionReady: {},
};

const mockSessionStoreSetFn = vi.fn();

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => mockSessionStoreState,
    setState: (fn: (s: typeof mockSessionStoreState) => Partial<typeof mockSessionStoreState>) => {
      const result = fn(mockSessionStoreState);
      Object.assign(mockSessionStoreState, result);
      mockSessionStoreSetFn(result);
    },
  },
  insertAfterPinned: vi.fn((sessions, session) => [...sessions, session]),
}));

vi.mock("../src/mainview/stores/use-chat-store", () => ({
  useChatStore: { getState: () => ({ loadSessionMessages: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    subscribe: vi.fn().mockResolvedValue("mock-sub-id"),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: { getState: () => ({}) },
  handleBashEvent: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-supervisor-store", () => ({
  useSupervisorStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/agent-event-handler", () => ({
  handleAgentEvent: vi.fn(),
  toolCallNameMap: {},
}));

vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Now import the module under test
import { apiClient } from "../src/mainview/lib/api-client";
import type { SessionMeta } from "../src/mainview/types";

describe("coordinator.session_created 前端 handler 完整性诊断", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state
    mockSessionStoreState.sessionsByProject = {};
    mockSessionStoreState.coordinatorSubscriptions = {};
    mockSessionStoreSetFn.mockClear();
  });

  it("验证 coordinator.session_created handler 当前仅更新 sessionsByProject", async () => {
    // Setup: current session has projectPath with existing sessions
    const projectPath = "/fake/project";
    mockSessionStoreState.sessionsByProject = {
      [projectPath]: [{ sessionId: "parent-1", projectPath } as SessionMeta],
    };

    // Simulate the coordinator subscription handler
    // This is the EXACT code from session-subscriptions.ts:516-531
    const parentSessionId = "parent-1";
    const coordinatorHandler = (payload: { parentSessionId: string; session: SessionMeta }) => {
      if (payload.parentSessionId !== parentSessionId) return;

      // This is what the current code does
      const sessions =
        (mockSessionStoreState.sessionsByProject as Record<string, SessionMeta[]>)[projectPath] ||
        [];
      const existing = sessions.find((sess) => sess.sessionId === payload.session.sessionId);
      if (existing) return;

      (mockSessionStoreState.sessionsByProject as Record<string, SessionMeta[]>)[projectPath] = [
        ...sessions,
        payload.session,
      ];
    };

    // Simulate receiving coordinator.session_created event
    const newSessionMeta: SessionMeta = {
      sessionId: "sess_coord_123",
      name: "指派: test task",
      sessionPath: "/fake/sessions/sess_coord_123.jsonl",
      projectPath,
      parentSessionPath: null,
      messageCount: 0,
      firstMessage: "test task",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running",
    };

    coordinatorHandler({
      parentSessionId,
      session: newSessionMeta,
    });

    // Verify session was added to sessionsByProject
    const sessions = (mockSessionStoreState.sessionsByProject as Record<string, SessionMeta[]>)[
      projectPath
    ];
    expect(sessions.length).toBe(2);
    expect(sessions[1].sessionId).toBe("sess_coord_123");

    // BUT: verify what's MISSING — these are the gaps
    // 1. No coordinator.session.event subscription established
    const subscribeCalls = (apiClient.subscribe as ReturnType<typeof vi.fn>).mock.calls;
    const coordinatorSessionEventCalls = subscribeCalls.filter(
      (call: unknown[]) => call[0] === "coordinator.session.event",
    );
    expect(coordinatorSessionEventCalls.length).toBe(0);

    // 2. The new session meta has parentSessionPath: null
    // This means groupSessions() will treat it as a ROOT session, not a child
    expect(newSessionMeta.parentSessionPath).toBeNull();
  });

  it("验证 groupSessions 将 parentSessionPath=null 的委派会话归为根会话", () => {
    // Replicate groupSessions logic from SessionSidebar.tsx:30-98
    function groupSessions(rawSessions: SessionMeta[]) {
      const children: Record<string, SessionMeta[]> = {};
      const roots: SessionMeta[] = [];

      for (const sess of rawSessions) {
        if (sess.parentSessionPath) {
          if (!children[sess.parentSessionPath]) children[sess.parentSessionPath] = [];
          children[sess.parentSessionPath].push(sess);
        } else {
          roots.push(sess);
        }
      }

      return { rootSessions: roots, childMap: children };
    }

    const parentSession: SessionMeta = {
      sessionId: "parent-1",
      name: "Parent Session",
      sessionPath: "/fake/sessions/parent-1.jsonl",
      projectPath: "/fake/project",
      parentSessionPath: null,
      messageCount: 5,
      firstMessage: "hello",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
    };

    // Delegate session as currently created by handleCoordinatorDelegate
    const delegateSession: SessionMeta = {
      sessionId: "sess_coord_123",
      name: "指派: task",
      sessionPath: "/fake/sessions/sess_coord_123.jsonl",
      projectPath: "/fake/project",
      parentSessionPath: null, // ← THIS IS THE PROBLEM
      messageCount: 0,
      firstMessage: "task",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running",
    };

    const { rootSessions, childMap } = groupSessions([parentSession, delegateSession]);

    // Because parentSessionPath is null, delegate is treated as root
    expect(rootSessions.length).toBe(2);
    expect(childMap).toEqual({});

    // What it SHOULD be: delegateSession.parentSessionPath = parentSession.sessionPath
    // Then: rootSessions = [parentSession], childMap = { "/fake/sessions/parent-1.jsonl": [delegateSession] }
  });

  it("验证正确的 parentSessionPath 能让委派会话作为子节点显示", () => {
    function groupSessions(rawSessions: SessionMeta[]) {
      const children: Record<string, SessionMeta[]> = {};
      const roots: SessionMeta[] = [];

      for (const sess of rawSessions) {
        if (sess.parentSessionPath) {
          if (!children[sess.parentSessionPath]) children[sess.parentSessionPath] = [];
          children[sess.parentSessionPath].push(sess);
        } else {
          roots.push(sess);
        }
      }

      return { rootSessions: roots, childMap: children };
    }

    const parentSession: SessionMeta = {
      sessionId: "parent-1",
      name: "Parent Session",
      sessionPath: "/fake/sessions/parent-1.jsonl",
      projectPath: "/fake/project",
      parentSessionPath: null,
      messageCount: 5,
      firstMessage: "hello",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
    };

    // FIXED: set parentSessionPath to parent's sessionPath
    const delegateSession: SessionMeta = {
      sessionId: "sess_coord_123",
      name: "指派: task",
      sessionPath: "/fake/sessions/sess_coord_123.jsonl",
      projectPath: "/fake/project",
      parentSessionPath: parentSession.sessionPath, // ← FIXED
      messageCount: 0,
      firstMessage: "task",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "running",
    };

    const { rootSessions, childMap } = groupSessions([parentSession, delegateSession]);

    // With correct parentSessionPath, delegate appears as child
    expect(rootSessions.length).toBe(1);
    expect(rootSessions[0].sessionId).toBe("parent-1");
    expect(childMap[parentSession.sessionPath]).toBeDefined();
    expect(childMap[parentSession.sessionPath].length).toBe(1);
    expect(childMap[parentSession.sessionPath][0].sessionId).toBe("sess_coord_123");
  });
});
