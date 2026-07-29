/**
 * TDD Test: requestSnapshot 竞态条件
 *
 * 问题：setupSubscriptions 在 subscribe("rules.event").then() 回调中
 *       立刻调用 requestSnapshot，但此时 agent.start 可能还没完成，
 *       导致 25次/天的 "requestSnapshot: no active session" WARN。
 *
 * 期望：setupSubscriptions 不应主动调用 requestSnapshot。
 *       requestSnapshot 应在 agent.start 返回后由调用方按需触发。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Hoisted mocks ---
const { mockCall, mockSubscribe } = vi.hoisted(() => ({
  mockCall: vi.fn(() => Promise.resolve({ type: "snapshot", totalRules: 0 })),
  mockSubscribe: vi.fn(() => Promise.resolve("sub-id")),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    subscribe: mockSubscribe,
    call: mockCall,
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "test-session",
      activeProjectId: "proj-1",
      projectTabs: [{ id: "proj-1", path: "/project" }],
      sessionsByProject: {},
    })),
  },
  insertAfterPinned: vi.fn((sessions, newSession) => [...sessions, newSession]),
}));

vi.mock("../../../src/mainview/stores/use-rules-store", () => ({
  useRulesStore: {
    getState: vi.fn(() => ({
      bySession: {},
      handleRulesEvent: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-lsp-store", () => ({
  useLspStore: {
    getState: vi.fn(() => ({
      bySession: {},
      handleLspEvent: vi.fn(),
      loadHistory: vi.fn(() => Promise.resolve()),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      messagesBySession: {},
      setMessagesForSession: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      eventsBySession: {},
      addEvent: vi.fn(),
      loadFiles: vi.fn(() => Promise.resolve()),
      addInjected: vi.fn(),
    })),
  },
}));

import { setupSubscriptions } from "../../../src/mainview/stores/session-subscriptions";

function createMockState() {
  return {
    projectTabs: [{ id: "proj-1", path: "/project" }],
    activeProjectId: "proj-1",
    agentSubscriptions: {} as Record<string, string>,
    batchSubscriptions: {} as Record<string, string>,
    subagentSubscriptions: {} as Record<string, string>,
    todoSubscriptions: {} as Record<string, string>,
    bashSubscriptions: {} as Record<string, string>,
    lspSubscriptions: {} as Record<string, string>,
    rulesSubscriptions: {} as Record<string, string>,
    notifySubscriptions: {} as Record<string, string>,
    memorySubscriptions: {} as Record<string, string>,
    coordinatorSubscriptions: {} as Record<string, string>,
    goalSubscriptions: {},
  };
}

function createMockSet(state: ReturnType<typeof createMockState>) {
  return (fn: (s: typeof state) => Partial<typeof state>) => {
    const update = fn(state);
    Object.assign(state, update);
  };
}

describe("requestSnapshot 竞态条件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setupSubscriptions 不应在 subscribe 回调中调用 rules.requestSnapshot", async () => {
    const state = createMockState();
    const set = createMockSet(state);
    const session = {
      sessionId: "test-session",
      projectPath: "/project",
      sessionPath: "/sessions/test.jsonl",
    };

    setupSubscriptions(state, set, "test-session", session);

    // 等待所有 microtask 完成（subscribe().then() 回调）
    await vi.runAllTimersAsync();

    // 核心断言：setupSubscriptions 不应主动调用 requestSnapshot
    const snapshotCalls = mockCall.mock.calls.filter(
      (call: unknown[]) => call[0] === "rules.requestSnapshot",
    );
    expect(snapshotCalls).toHaveLength(0);
  });

  it("rules 订阅应正常建立（subscribe 被调用）", async () => {
    const state = createMockState();
    const set = createMockSet(state);
    const session = {
      sessionId: "test-session",
      projectPath: "/project",
      sessionPath: "/sessions/test.jsonl",
    };

    setupSubscriptions(state, set, "test-session", session);

    await vi.runAllTimersAsync();

    // 应订阅了 rules.event
    const rulesSubs = mockSubscribe.mock.calls.filter(
      (call: unknown[]) => call[0] === "rules.event",
    );
    expect(rulesSubs.length).toBeGreaterThanOrEqual(1);
  });
});
