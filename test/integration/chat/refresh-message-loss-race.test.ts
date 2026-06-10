import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
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
      restoreContextFromHistory: vi.fn(),
      updateSessionStatus: vi.fn(),
      updateSessionContext: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      addEvent: vi.fn(),
      addInjected: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: {
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-retry-store", () => ({
  useRetryStore: {
    getState: vi.fn(() => ({
      startRetry: vi.fn(),
      endRetry: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: vi.fn(() => ({
      registerUIRequest: vi.fn(),
      clearPendingBySession: vi.fn(),
    })),
  },
}));

vi.mock("../../../src/mainview/stores/use-change-review-store", () => ({
  useChangeReviewStore: {
    getState: vi.fn(() => ({ fetchPending: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch_result"]),
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  syncBashStoreToChat: vi.fn(),
}));

import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { handleAgentEvent, toolCallNameMap, toolCallArgsMap } from "../../../src/mainview/stores/agent-event-handler";
import { hasSameMessageSnapshots } from "../../../src/mainview/stores/chat-message-snapshot";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";
import { hasRenderableContent } from "../../../src/mainview/stores/agent-event-reconciler";

const SID = "sess-1";

function userMsg(id: string, text: string, ts: number): ChatMessage {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: ts,
  };
}

function assistantMsg(
  id: string,
  text: string,
  ts: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: ts,
    isStreaming: false,
    ...extra,
  };
}

function streamingAssistantMsg(
  id: string,
  content: ContentBlock[],
  ts: number,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: ts,
    isStreaming: true,
  };
}

function getUserIds(msgs: ChatMessage[]): string[] {
  return msgs.filter((m) => m.role === "user").map((m) => m.id);
}

function getAssistantIds(msgs: ChatMessage[]): string[] {
  return msgs.filter((m) => m.role === "assistant").map((m) => m.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(toolCallNameMap)) delete toolCallNameMap[key];
  for (const key of Object.keys(toolCallArgsMap)) delete toolCallArgsMap[key];
  useChatStore.setState({
    messagesBySession: {},
    activeToolCallIdsBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
});

describe("refresh message_end replay race", () => {
  it("reproduces user message loss via message_start + message_end replay after loadSessionMessages", () => {
    const initialMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      userMsg("u2", "How are you?", 3000),
      assistantMsg("a2", "I'm fine", 4000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    useChatStore.getState().setMessagesForSession(SID, initialMessages);

    const store = useChatStore.getState().messagesBySession[SID];
    expect(store).toHaveLength(4);
    expect(getUserIds(store)).toEqual(["u1", "u2"]);

    const event_start = {
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
      },
    };

    handleAgentEvent(SID, event_start as never);

    const afterStart = useChatStore.getState().messagesBySession[SID];
    expect(afterStart).toHaveLength(5);

    const lastMsg = afterStart[afterStart.length - 1];
    expect(lastMsg.role).toBe("assistant");
    expect(lastMsg.isStreaming).toBe(true);

    expect(getUserIds(afterStart)).toEqual(["u1", "u2"]);

    const event_end = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "endTurn",
        usage: { input: 0, output: 0 },
      },
      entryId: "entry-end",
    };

    handleAgentEvent(SID, event_end as never);

    const afterEnd = useChatStore.getState().messagesBySession[SID];
    expect(getUserIds(afterEnd)).toEqual(["u1", "u2"]);

    expect(afterEnd).toHaveLength(4);

    const assistantIds = getAssistantIds(afterEnd);
    expect(assistantIds).toContain("a1");
    expect(assistantIds).toContain("a2");
  });

  it("demonstrates race: message_end triggers fire-and-forget loadSessionMessages that can race with _backgroundRefreshMessages", async () => {
    const initialMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      userMsg("u2", "How are you?", 3000),
      assistantMsg("a2", "I'm fine", 4000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    useChatStore.getState().setMessagesForSession(SID, initialMessages);

    const event_start = {
      type: "message_start",
      message: { role: "assistant", content: [] },
    };
    handleAgentEvent(SID, event_start as never);

    const event_end = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "endTurn",
        usage: { input: 0, output: 0 },
      },
      entryId: "entry-end",
    };
    handleAgentEvent(SID, event_end as never);

    const afterEnd = useChatStore.getState().messagesBySession[SID];
    expect(afterEnd).toHaveLength(4);
    expect(getUserIds(afterEnd)).toEqual(["u1", "u2"]);

    const racingServerMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      userMsg("u2", "How are you?", 3000),
      assistantMsg("a2", "I'm fine", 4000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    expect(hasSameMessageSnapshots(afterEnd, racingServerMessages)).toBe(true);
  });

  it("reproduces actual message loss when _backgroundRefreshMessages returns fewer messages than current store", () => {
    const currentMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      userMsg("u2", "How are you?", 3000),
      assistantMsg("a2", "I'm fine", 4000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    useChatStore.getState().setMessagesForSession(SID, currentMessages);

    const staleServerMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    expect(hasSameMessageSnapshots(currentMessages, staleServerMessages)).toBe(false);

    useChatStore.getState().setMessagesForSession(SID, staleServerMessages);

    const afterOverwrite = useChatStore.getState().messagesBySession[SID];
    expect(afterOverwrite).toHaveLength(2);
    expect(getUserIds(afterOverwrite)).toEqual(["u1"]);
    expect(afterOverwrite.some((m) => m.id === "u2")).toBe(false);
    expect(afterOverwrite.some((m) => m.id === "a2")).toBe(false);
  });

  it("message_start creates duplicate when existing assistant is not streaming", () => {
    const messages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, {
        tokenUsage: { input: 10, output: 5, cost: 0 },
      }),
    ];

    useChatStore.getState().setMessagesForSession(SID, messages);

    const event_start = {
      type: "message_start",
      message: { role: "assistant", content: [] },
    };

    handleAgentEvent(SID, event_start as never);

    const after = useChatStore.getState().messagesBySession[SID];
    expect(after).toHaveLength(3);
    expect(getUserIds(after)).toEqual(["u1"]);

    const lastTwo = after.slice(-2);
    expect(lastTwo[0].role).toBe("assistant");
    expect(lastTwo[0].isStreaming).toBe(false);
    expect(lastTwo[1].role).toBe("assistant");
    expect(lastTwo[1].isStreaming).toBe(true);
    expect(lastTwo[1].content).toEqual([]);
  });

  it("message_end with empty content and endTurn stopReason triggers priorMessages + force reload", () => {
    const messages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000, {
        tokenUsage: { input: 10, output: 5, cost: 0 },
      }),
      userMsg("u2", "How are you?", 3000),
      streamingAssistantMsg("a2-dup", [], 4500),
    ];

    useChatStore.getState().setMessagesForSession(SID, messages);

    const event_end = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        stopReason: "endTurn",
        usage: { input: 0, output: 0 },
      },
      entryId: "entry-end",
    };

    handleAgentEvent(SID, event_end as never);

    const after = useChatStore.getState().messagesBySession[SID];
    expect(getUserIds(after)).toEqual(["u1", "u2"]);

    expect(after).toHaveLength(3);
    expect(after.some((m) => m.id === "a2-dup")).toBe(false);
  });

  it("full replay sequence: message_start → message_end preserves all user messages", () => {
    const loaded: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi there", 2000, {
        tokenUsage: { input: 10, output: 5, cost: 0 },
      }),
      userMsg("u2", "How are you?", 3000),
      assistantMsg("a2", "I'm fine", 4000, {
        tokenUsage: { input: 10, output: 5, cost: 0 },
      }),
      userMsg("u3", "Tell me more", 5000),
      assistantMsg("a3", "Sure thing", 6000, {
        tokenUsage: { input: 10, output: 5, cost: 0 },
      }),
    ];

    useChatStore.getState().setMessagesForSession(SID, loaded);

    handleAgentEvent(
      SID,
      { type: "message_start", message: { role: "assistant", content: [] } } as never,
    );

    const afterStart = useChatStore.getState().messagesBySession[SID];
    expect(afterStart).toHaveLength(7);
    expect(getUserIds(afterStart)).toEqual(["u1", "u2", "u3"]);

    handleAgentEvent(
      SID,
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "endTurn",
          usage: { input: 0, output: 0 },
        },
        entryId: "entry-end-3",
      } as never,
    );

    const afterEnd = useChatStore.getState().messagesBySession[SID];
    expect(getUserIds(afterEnd)).toEqual(["u1", "u2", "u3"]);
    expect(afterEnd).toHaveLength(6);
  });
});

describe("hasSameMessageSnapshots behavior in race conditions", () => {
  it("detects no change when server returns same messages", () => {
    const current: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000),
    ];

    const server: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000),
    ];

    expect(hasSameMessageSnapshots(current, server)).toBe(true);
  });

  it("detects change when server returns fewer messages (user message lost)", () => {
    const current: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000),
      userMsg("u2", "World", 3000),
      assistantMsg("a2", "Done", 4000),
    ];

    const staleServer: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000),
    ];

    expect(hasSameMessageSnapshots(current, staleServer)).toBe(false);
  });

  it("returns false for messages with different streaming state", () => {
    const current: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        timestamp: 1000,
        isStreaming: true,
      },
    ];

    const server: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "Hi" }],
        timestamp: 1000,
        isStreaming: false,
      },
    ];

    expect(hasSameMessageSnapshots(current, server)).toBe(false);
  });
});

describe("helper functions used in race condition logic", () => {
  it("hasRenderableContent returns false for empty content array", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [],
      timestamp: 1000,
      isStreaming: true,
    };
    expect(hasRenderableContent(msg)).toBe(false);
  });

  it("hasRenderableContent returns true for text with content", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
      timestamp: 1000,
    };
    expect(hasRenderableContent(msg)).toBe(true);
  });

  it("hasRenderableContent returns false for empty text", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "   " }],
      timestamp: 1000,
    };
    expect(hasRenderableContent(msg)).toBe(false);
  });

  it("hasRenderableContent returns true for toolExecution blocks", () => {
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [
        {
          type: "toolExecution",
          toolCallId: "tc-1",
          toolName: "bash",
          args: "echo hi",
          status: "running",
        },
      ],
      timestamp: 1000,
    };
    expect(hasRenderableContent(msg)).toBe(true);
  });
});

describe("race scenario: fire-and-forget loadSessionMessages vs _backgroundRefreshMessages", () => {
  it("demonstrates that two concurrent setMessagesForSession calls can lose messages", () => {
    const fullMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      userMsg("u2", "World", 3000),
      assistantMsg("a2", "Done", 4000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    useChatStore.getState().setMessagesForSession(SID, fullMessages);

    const staleMessages: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
    ];

    useChatStore.getState().setMessagesForSession(SID, staleMessages);

    const result = useChatStore.getState().messagesBySession[SID];
    expect(result).toHaveLength(2);
    expect(result.some((m) => m.id === "u2")).toBe(false);
    expect(result.some((m) => m.id === "a2")).toBe(false);

    expect(getUserIds(result)).toEqual(["u1"]);
  });

  it("shows message_end replay correctly drops only the duplicate streaming assistant", () => {
    const beforeReplay: ChatMessage[] = [
      userMsg("u1", "Hello", 1000),
      assistantMsg("a1", "Hi", 2000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      userMsg("u2", "World", 3000),
      assistantMsg("a2", "Done", 4000, { tokenUsage: { input: 10, output: 5, cost: 0 } }),
      streamingAssistantMsg("a2-dup-streaming", [], 4500),
    ];

    useChatStore.getState().setMessagesForSession(SID, beforeReplay);

    const msgs = useChatStore.getState().messagesBySession[SID];
    expect(msgs).toHaveLength(5);

    const priorMessages = msgs.slice(0, -1);
    expect(priorMessages).toHaveLength(4);
    expect(getUserIds(priorMessages)).toEqual(["u1", "u2"]);

    useChatStore.getState().setMessagesForSession(SID, priorMessages);

    const after = useChatStore.getState().messagesBySession[SID];
    expect(after).toHaveLength(4);
    expect(getUserIds(after)).toEqual(["u1", "u2"]);
    expect(getAssistantIds(after)).toEqual(["a1", "a2"]);
  });
});
