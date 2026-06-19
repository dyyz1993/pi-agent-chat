/**
 * 验证测试：回滚后的消息完整性
 *
 * 验证场景：
 * 1. 回滚到某个时间点后，该时间点之前的消息是否完整保留
 * 2. 回滚点之后的消息是否被正确移除
 * 3. 压缩后再回滚，消息是否完整
 * 4. loadMoreMessages（历史加载）后的回滚是否正常
 * 5. 第一条用户消息是否始终可见
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const memoryStoreMock = {
  clearSession: vi.fn(),
  addEvent: vi.fn(),
  addInjected: vi.fn(),
};

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
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

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": true },
      sessionStatusMap: {},
      sessionContextMap: {},
      sessionsByProject: {},
      restoreContextFromHistory: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => memoryStoreMock),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result"]),
}));

import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    isLoadingMoreBySession: {},
    hasMoreMessagesBySession: {},
    nextCursorBySession: {},
  });
  memoryStoreMock.clearSession.mockClear();
  memoryStoreMock.addEvent.mockClear();
  memoryStoreMock.addInjected.mockClear();
});

function makeMessages(
  count: number,
  startTs = 1000,
): Array<{ id: string; role: string; content: string; timestamp: number }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    role: i % 2 === 0 ? "user" : "assistant",
    content: i % 2 === 0 ? `message ${i + 1}` : `[{"type":"text","text":"reply ${i + 1}"}]`,
    timestamp: startTs + i * 1000,
  }));
}

// ============================================================
// 场景 1: 基本回滚 - 之前的保留，之后的移除
// ============================================================
describe("基本回滚：前后消息完整性", () => {
  it("回滚后 force reload 返回的消息数量减少", async () => {
    const sessionId = "sess-rollback";

    const fullMessages = makeMessages(10);

    mockedCall.mockResolvedValueOnce({
      messages: fullMessages,
      customEntries: [],
      hasMore: false,
      totalCount: 10,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);
    expect(useChatStore.getState().messagesBySession[sessionId]).toHaveLength(10);

    const beforeCount = useChatStore.getState().messagesBySession[sessionId].length;

    mockedCall.mockResolvedValueOnce({
      messages: fullMessages.slice(0, 5),
      customEntries: [],
      hasMore: false,
      totalCount: 5,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const afterCount = useChatStore.getState().messagesBySession[sessionId].length;

    expect(afterCount).toBeLessThan(beforeCount);
    expect(afterCount).toBe(5);
  });

  it("回滚后保留的消息都是回滚点之前的", async () => {
    const sessionId = "sess-rollback-order";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(10),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    const rollbackPoint = 5;
    const keptMessages = makeMessages(rollbackPoint);

    mockedCall.mockResolvedValueOnce({
      messages: keptMessages,
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs).toHaveLength(rollbackPoint);

    const msgIds = msgs.map((m) => m.id);
    expect(msgIds).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });
});

// ============================================================
// 场景 2: 回滚后第一条用户消息始终可见
// ============================================================
describe("回滚后第一条用户消息始终可见", () => {
  it("回滚到第 2 轮对话后，第 1 条用户消息仍在", async () => {
    const sessionId = "sess-first-msg";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(10),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(2),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs).toHaveLength(2);

    const firstMsg = msgs[0];
    expect(firstMsg.role).toBe("user");
    expect(firstMsg.id).toBe("m1");
  });

  it("回滚到只剩 1 条消息时，仍然是第一条用户消息", async () => {
    const sessionId = "sess-only-first";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(10),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    mockedCall.mockResolvedValueOnce({
      messages: [makeMessages(1)[0]],
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
  });
});

// ============================================================
// 场景 3: 压缩 + 回滚交互
// ============================================================
describe("压缩 + 回滚交互", () => {
  it("压缩后回滚，压缩摘要消息和之前的消息都在", async () => {
    const sessionId = "sess-compact-rollback";

    const preCompact = makeMessages(6);
    const compactMsg = {
      id: "compact-1",
      role: "compactionSummary",
      summary: "压缩了前 4 条消息",
      tokensBefore: 10000,
      timestamp: 7000,
    };
    const postCompact = makeMessages(2, 8000).map((m) => ({ ...m, id: `post-${m.id}` }));

    mockedCall.mockResolvedValueOnce({
      messages: [...preCompact, compactMsg, ...postCompact],
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    const allMsgs = useChatStore.getState().messagesBySession[sessionId];
    expect(allMsgs.length).toBe(9);

    mockedCall.mockResolvedValueOnce({
      messages: preCompact.slice(0, 4),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs).toHaveLength(4);

    const hasCompact = msgs.some((m) => m.role === "compactionSummary");
    expect(hasCompact).toBe(false);

    expect(msgs[0].id).toBe("m1");
    expect(msgs[0].role).toBe("user");
  });

  it("回滚后压缩摘要仍在（回滚点在压缩之后）", async () => {
    const sessionId = "sess-rollback-keep-compact";

    const preCompact = makeMessages(6);
    const compactMsg = {
      id: "compact-1",
      role: "compactionSummary",
      summary: "压缩了前 4 条消息",
      tokensBefore: 10000,
      timestamp: 7000,
    };
    const postCompact = makeMessages(2, 8000).map((m) => ({ ...m, id: `post-${m.id}` }));

    mockedCall.mockResolvedValueOnce({
      messages: [...preCompact, compactMsg, ...postCompact],
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    mockedCall.mockResolvedValueOnce({
      messages: [...preCompact, compactMsg],
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    const hasCompact = msgs.some((m) => m.role === "compactionSummary");
    expect(hasCompact).toBe(true);
  });
});

// ============================================================
// 场景 4: 历史加载后回滚
// ============================================================
describe("历史加载(loadMoreMessages)后回滚", () => {
  it("先 loadMore 拿到完整历史，再回滚仍能正确工作", async () => {
    const sessionId = "sess-history-rollback";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(2, 9000),
      customEntries: [],
      hasMore: true,
      totalCount: 10,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);
    expect(useChatStore.getState().hasMoreMessagesBySession[sessionId]).toBe(true);

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(10),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadMoreMessages(sessionId);
    expect(useChatStore.getState().messagesBySession[sessionId]).toHaveLength(10);

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(4),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    expect(msgs).toHaveLength(4);
    expect(msgs[0].id).toBe("m1");
    expect(msgs[0].role).toBe("user");
  });
});

// ============================================================
// 场景 5: 回滚后 historyLoadVersion 正确递增
// ============================================================
describe("回滚后 historyLoadVersion", () => {
  it("force reload 递增 historyLoadVersion", async () => {
    const sessionId = "sess-version";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(5),
      customEntries: [],
      hasMore: false,
    });

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(3, 1000),
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);
    const v1 = useChatStore.getState().historyLoadVersion;

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });
    const v2 = useChatStore.getState().historyLoadVersion;

    expect(v2).toBeGreaterThan(v1);
  });
});

// ============================================================
// 场景 6: 回滚后 customEntries 也正确过滤
// ============================================================
describe("回滚后 customEntries 过滤", () => {
  it("回滚后 memory customEntries 只同步当前分支，并加入 chat messages", async () => {
    const sessionId = "sess-custom-rollback";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(6),
      customEntries: [
        {
          id: "ce-1",
          customType: "memory_prefetch",
          data: { query: "before rollback" },
          timestamp: 1500,
        },
        {
          id: "ce-2",
          customType: "memory_prefetch",
          data: { query: "after rollback point" },
          timestamp: 5500,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    const allMsgs = useChatStore.getState().messagesBySession[sessionId];
    const customCount = allMsgs.filter(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "custom"),
    ).length;
    expect(customCount).toBe(2);
    expect(memoryStoreMock.clearSession).toHaveBeenCalledWith(sessionId);
    expect(memoryStoreMock.addEvent).toHaveBeenCalledTimes(2);

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(3),
      customEntries: [
        {
          id: "ce-1",
          customType: "memory_prefetch",
          data: { query: "before rollback" },
          timestamp: 1500,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId];
    const customMsgs = msgs.filter(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "custom"),
    );
    expect(customMsgs).toHaveLength(1);
    expect(customMsgs[0].id).toBe("ce-1");
    expect(memoryStoreMock.clearSession).toHaveBeenCalledTimes(2);
    expect(memoryStoreMock.addEvent).toHaveBeenLastCalledWith(
      sessionId,
      expect.objectContaining({ id: "ce-1", customType: "memory_prefetch" }),
    );
  });
});

// ============================================================
// 场景 7: 回滚后 hasMoreMessages 正确重算
// ============================================================
describe("回滚后 hasMoreMessages", () => {
  it("回滚后消息变少，hasMore 应该是 false", async () => {
    const sessionId = "sess-hasmore";

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(10),
      customEntries: [],
      hasMore: true,
      totalCount: 50,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);
    expect(useChatStore.getState().hasMoreMessagesBySession[sessionId]).toBe(true);

    mockedCall.mockResolvedValueOnce({
      messages: makeMessages(3),
      customEntries: [],
      hasMore: false,
      totalCount: 3,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });
    expect(useChatStore.getState().hasMoreMessagesBySession[sessionId]).toBe(false);
  });
});
