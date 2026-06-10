/**
 * 验证测试：历史消息加载 & 压缩标识显示
 *
 * 验证四个关键问题的修复：
 * 1. memory customEntries 同步到 memory store，但不进入 chat messages
 * 2. loadMoreMessages 正确递增 historyLoadVersion
 * 3. compactionSummary 空 summary 不再被丢弃
 * 4. loadMoreMessages 使用服务端返回的 hasMore
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const memoryStoreMock = {
  addEvent: vi.fn(),
  addInjected: vi.fn(),
  clearSession: vi.fn(),
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
      sessionContextMap: {},
      sessionStatusMap: {},
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
import { messageToChatMessage } from "../../../src/mainview/lib/message-mapper";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    isLoadingMoreBySession: {},
    hasMoreMessagesBySession: {},
  });
  memoryStoreMock.addEvent.mockClear();
  memoryStoreMock.addInjected.mockClear();
  memoryStoreMock.clearSession.mockClear();
});

// ============================================================
// 修复 1: memory customEntries 不污染 chat messages
// ============================================================
describe("FIX: loadMoreMessages 处理 customEntries", () => {
  it("loadSessionMessages 同步 memory customEntries 到 memory store，不加入 chat messages", async () => {
    const sessionId = "sess-history";

    mockedCall.mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: "old msg", timestamp: 1000 },
        {
          id: "m2",
          role: "assistant",
          content: [{ type: "text", text: "reply" }],
          timestamp: 2000,
        },
      ],
      customEntries: [
        {
          id: "ce-1",
          customType: "memory_prefetch",
          data: { query: "search test" },
          timestamp: 1500,
        },
      ],
      hasMore: false,
      totalCount: 2,
    });

    await useChatStore.getState().loadSessionMessages(sessionId);

    const msgs = useChatStore.getState().messagesBySession[sessionId] ?? [];
    expect(msgs).toHaveLength(2);
    expect(msgs.some((m) => m.role === "custom")).toBe(false);
    expect(memoryStoreMock.clearSession).toHaveBeenCalledWith(sessionId);
    expect(memoryStoreMock.addEvent).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ id: "ce-1", customType: "memory_prefetch" }),
    );
  });

  it("loadMoreMessages 忽略全量 memory customEntries，避免历史分页重复塞隐藏消息", async () => {
    const sessionId = "sess-loadmore";

    useChatStore.setState({
      messagesBySession: {
        [sessionId]: [
          { id: "m1", role: "user", content: [{ type: "text", text: "recent" }], timestamp: 10000 },
        ],
      },
      hasMoreMessagesBySession: { [sessionId]: true },
    });

    mockedCall.mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: "recent", timestamp: 10000 },
        { id: "m0", role: "user", content: "old", timestamp: 1000 },
      ],
      customEntries: [
        {
          id: "ce-old",
          customType: "memory_prefetch",
          data: { query: "old search" },
          timestamp: 5000,
        },
      ],
    });

    await useChatStore.getState().loadMoreMessages(sessionId);

    const msgs = useChatStore.getState().messagesBySession[sessionId] ?? [];

    expect(msgs).toHaveLength(2);
    expect(msgs.some((m) => m.role === "custom")).toBe(false);
    expect(memoryStoreMock.addEvent).not.toHaveBeenCalled();
  });
});

// ============================================================
// 修复 2: loadMoreMessages 递增 historyLoadVersion
// ============================================================
describe("FIX: loadMoreMessages 递增 historyLoadVersion", () => {
  it("loadSessionMessages 递增 historyLoadVersion", async () => {
    const sessionId = "sess-ver";

    mockedCall.mockResolvedValue({
      messages: [{ id: "m1", role: "user", content: "hi", timestamp: 1000 }],
      hasMore: false,
    });

    const before = useChatStore.getState().historyLoadVersion;
    await useChatStore.getState().loadSessionMessages(sessionId);
    const after = useChatStore.getState().historyLoadVersion;

    expect(after).toBeGreaterThan(before);
  });

  it("loadMoreMessages 也递增 historyLoadVersion", async () => {
    const sessionId = "sess-ver-more";

    useChatStore.setState({
      messagesBySession: {
        [sessionId]: [
          { id: "m1", role: "user", content: [{ type: "text", text: "x" }], timestamp: 1 },
        ],
      },
      hasMoreMessagesBySession: { [sessionId]: true },
      historyLoadVersion: 5,
    });

    mockedCall.mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: "x", timestamp: 1 },
        { id: "m0", role: "user", content: "y", timestamp: 0 },
      ],
    });

    const before = useChatStore.getState().historyLoadVersion;
    await useChatStore.getState().loadMoreMessages(sessionId);
    const after = useChatStore.getState().historyLoadVersion;

    expect(after).toBeGreaterThan(before);
  });
});

// ============================================================
// 修复 3: compactionSummary 空 summary 不再被丢弃
// ============================================================
describe("FIX: compactionSummary 空 summary 保留消息", () => {
  it("有 summary 的 compactionSummary 正常映射", () => {
    const result = messageToChatMessage(
      {
        role: "compactionSummary",
        summary: "对话已压缩，移除了 50 条旧消息",
        tokensBefore: 12000,
        timestamp: 1000,
      } as unknown as Parameters<typeof messageToChatMessage>[0],
      "compaction-1",
    );

    expect(result).not.toBeNull();
    expect(result?.role).toBe("compactionSummary");
    expect(result?.content[0]).toEqual({
      type: "compactionSummary",
      summary: "对话已压缩，移除了 50 条旧消息",
      tokensBefore: 12000,
    });
  });

  it("summary 为空字符串时不再返回 null", () => {
    const result = messageToChatMessage(
      {
        role: "compactionSummary",
        summary: "",
        tokensBefore: 12000,
        timestamp: 1000,
      } as unknown as Parameters<typeof messageToChatMessage>[0],
      "compaction-2",
    );

    expect(result).not.toBeNull();
    expect(result?.role).toBe("compactionSummary");
    expect(result?.content[0]).toEqual({
      type: "compactionSummary",
      summary: "",
      tokensBefore: 12000,
    });
  });

  it("summary 为 undefined 时不再返回 null", () => {
    const result = messageToChatMessage(
      { role: "compactionSummary", tokensBefore: 12000, timestamp: 1000 } as unknown as Parameters<
        typeof messageToChatMessage
      >[0],
      "compaction-3",
    );

    expect(result).not.toBeNull();
    expect(result?.role).toBe("compactionSummary");
  });

  it("compaction_end force reload 后，空 summary 的消息也保留", async () => {
    const sessionId = "sess-compaction";

    mockedCall.mockResolvedValue({
      messages: [
        { id: "m1", role: "user", content: "hello", timestamp: 1000 },
        { id: "m2", role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 2000 },
        { id: "m3", role: "compactionSummary", summary: "", tokensBefore: 10000, timestamp: 3000 },
      ],
      customEntries: [],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages(sessionId, { force: true });

    const msgs = useChatStore.getState().messagesBySession[sessionId] ?? [];
    const hasCompaction = msgs.some((m) => m.role === "compactionSummary");

    expect(hasCompaction).toBe(true);
  });
});

// ============================================================
// 修复 4: loadMoreMessages 使用服务端 hasMore
// ============================================================
describe("FIX: loadMoreMessages 使用服务端 hasMore", () => {
  it("服务端返回 hasMore: true 时前端也设为 true", async () => {
    const sessionId = "sess-more";

    useChatStore.setState({
      messagesBySession: {
        [sessionId]: [
          { id: "m1", role: "user", content: [{ type: "text", text: "x" }], timestamp: 1 },
        ],
      },
      hasMoreMessagesBySession: { [sessionId]: true },
    });

    mockedCall.mockResolvedValue({
      messages: [{ id: "m1", role: "user", content: "x", timestamp: 1 }],
      hasMore: true,
      totalCount: 500,
    });

    await useChatStore.getState().loadMoreMessages(sessionId);

    expect(useChatStore.getState().hasMoreMessagesBySession[sessionId]).toBe(true);
  });

  it("服务端返回 hasMore: false 时前端也设为 false", async () => {
    const sessionId = "sess-more-false";

    useChatStore.setState({
      messagesBySession: {
        [sessionId]: [
          { id: "m1", role: "user", content: [{ type: "text", text: "x" }], timestamp: 1 },
        ],
      },
      hasMoreMessagesBySession: { [sessionId]: true },
    });

    mockedCall.mockResolvedValue({
      messages: [{ id: "m1", role: "user", content: "x", timestamp: 1 }],
      hasMore: false,
      totalCount: 2,
    });

    await useChatStore.getState().loadMoreMessages(sessionId);

    expect(useChatStore.getState().hasMoreMessagesBySession[sessionId]).toBe(false);
  });
});
