/**
 * @vitest-environment happy-dom
 *
 * 测试: 手动压缩 (/compact-force) 后 slash command 本地消息的清理
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const updateStatusMock = vi.fn();

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn(), mode: "web" })) },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": true },
      sessionContextMap: {},
      sessionsByProject: {},
      updateSessionStatus: updateStatusMock,
      restoreContextFromHistory: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(),
  extractTokenUsage: vi.fn(() => null),
}));

import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import type { ChatMessage } from "../../../src/mainview/types";

function makeUserMsg(text: string, local = false): ChatMessage {
  return {
    id: `user_${Date.now()}_${Math.random()}`,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    _local: local,
  };
}

function makeAssistantMsg(text: string): ChatMessage {
  return {
    id: `asst_${Date.now()}_${Math.random()}`,
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

function makeCompactionMsg(): ChatMessage {
  return {
    id: `compact_${Date.now()}`,
    role: "compactionSummary",
    content: [{ type: "compactionSummary", summary: "对话摘要", tokensBefore: 50000 }],
    timestamp: Date.now(),
  };
}

/** 从消息列表中提取纯文本 */
function extractText(msg: ChatMessage): string {
  return msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
}

/** 复现 use-chat-store.ts 中的 dedup 逻辑 (含我们的修复) */
function dedupLocalMsgs(localMsgs: ChatMessage[], displayMsgs: ChatMessage[]): ChatMessage[] {
  return localMsgs.filter((local) => {
    if (local.role !== "user") return true;
    const localText = extractText(local);
    if (!localText) return true;
    if (localText.startsWith("/")) return false; // ← 修复: slash command 丢弃
    return !displayMsgs.some((srv) => {
      if (srv.role !== "user") return false;
      return extractText(srv) === localText;
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateStatusMock.mockClear();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set<string>(),
    historyLoadVersion: 0,
    historyLoadVersionBySession: {},
    messageHydrationBySession: {},
    hasMoreMessagesBySession: {},
    isLoadingMoreBySession: {},
    activeToolCallIdsBySession: {},
    streamVersionBySession: {},
    nextCursorBySession: {},
    pendingImages: [],
  });
});

describe("slash command 本地消息 dedup", () => {
  it("reload 后丢弃 /compact-force 本地消息", () => {
    const slashMsg = makeUserMsg("/compact-force", true);
    const localMsgs = [slashMsg];

    // server 返回的消息中没有 /compact-force
    const displayMsgs = [makeUserMsg("你好"), makeAssistantMsg("你好！"), makeCompactionMsg()];

    const result = dedupLocalMsgs(localMsgs, displayMsgs);
    expect(result).toHaveLength(0);
  });

  it("reload 后保留普通用户本地消息 (server 未返回时)", () => {
    const normalMsg = makeUserMsg("你好，请帮我写代码", true);
    const localMsgs = [normalMsg];
    const displayMsgs: ChatMessage[] = [];

    const result = dedupLocalMsgs(localMsgs, displayMsgs);
    expect(result).toHaveLength(1);
    expect(extractText(result[0])).toBe("你好，请帮我写代码");
  });

  it("reload 后普通消息去重 (server 有匹配)", () => {
    const normalMsg = makeUserMsg("你好", true);
    const localMsgs = [normalMsg];
    const displayMsgs = [makeUserMsg("你好"), makeAssistantMsg("你好！")];

    const result = dedupLocalMsgs(localMsgs, displayMsgs);
    expect(result).toHaveLength(0);
  });

  it("混合场景: slash command 丢弃 + 普通消息保留", () => {
    const localMsgs = [makeUserMsg("/compact-force", true), makeUserMsg("帮我写代码", true)];
    const displayMsgs: ChatMessage[] = [];

    const result = dedupLocalMsgs(localMsgs, displayMsgs);
    expect(result).toHaveLength(1);
    expect(extractText(result[0])).toBe("帮我写代码");
  });
});

describe("slash command 发送状态", () => {
  it("/compact-force 发送时直接调用 agent.compact", async () => {
    const { apiClient } = await import("../../../src/mainview/lib/api-client");
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    useChatStore.setState({ inputText: "/compact-force" });
    await useChatStore.getState().sendMessage();

    expect(apiClient.call).toHaveBeenCalledWith("agent.compact", {
      sessionId: "sess-1",
      customInstructions: undefined,
    });
    expect(apiClient.call).not.toHaveBeenCalledWith(
      "agent.send",
      expect.objectContaining({ content: "/compact-force" }),
    );
    const compactingCall = updateStatusMock.mock.calls.find(([, s]) => s === "compacting");
    expect(compactingCall).toBeDefined();
  });

  it("/compact 后面的文本会作为压缩说明透传", async () => {
    const { apiClient } = await import("../../../src/mainview/lib/api-client");
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    useChatStore.setState({ inputText: "/compact 保留最近的任务目标和文件变更" });
    await useChatStore.getState().sendMessage();

    expect(apiClient.call).toHaveBeenCalledWith("agent.compact", {
      sessionId: "sess-1",
      customInstructions: "保留最近的任务目标和文件变更",
    });
  });

  it("/compact 失败时在消息列表保留压缩失败记录", async () => {
    const { apiClient } = await import("../../../src/mainview/lib/api-client");
    (apiClient.call as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Provider finish_reason: model_context_window_exceeded"),
    );

    useChatStore.setState({ inputText: "/compact" });
    await useChatStore.getState().sendMessage();

    const messages = useChatStore.getState().messagesBySession["sess-1"] || [];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "compactionSummary",
      _local: true,
    });
    expect(messages[0].content[0]).toMatchObject({
      type: "compactionSummary",
      status: "failed",
      reason: "Provider finish_reason: model_context_window_exceeded",
    });
  });

  it("普通消息发送时调 updateSessionStatus('streaming')", async () => {
    const { apiClient } = await import("../../../src/mainview/lib/api-client");
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    useChatStore.setState({ inputText: "你好" });
    await useChatStore.getState().sendMessage();

    const streamingCall = updateStatusMock.mock.calls.find(([, s]) => s === "streaming");
    expect(streamingCall).toBeDefined();
  });
});
