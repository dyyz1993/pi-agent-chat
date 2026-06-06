import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn(), mode: "web" })),
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": true },
      sessionContextMap: {},
      sessionsByProject: {},
      restoreContextFromHistory: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({ loadFiles: vi.fn(), addEvent: vi.fn(), addInjected: vi.fn() })),
  },
}));

vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: vi.fn(),
  extractTokenUsage: vi.fn(() => null),
}));

import { useChatStore, normalizeToolBlocks } from "../src/mainview/stores/use-chat-store";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";

beforeEach(() => {
  vi.clearAllMocks();
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
  });
});

describe("initial state", () => {
  it("has empty inputText", () => {
    expect(useChatStore.getState().inputText).toBe("");
  });

  it("has isStreaming false", () => {
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("has streamContentVersion 0", () => {
    expect(useChatStore.getState().streamContentVersion).toBe(0);
  });

  it("has empty messagesBySession", () => {
    expect(useChatStore.getState().messagesBySession).toEqual({});
  });

  it("has empty loadingSessions", () => {
    expect(useChatStore.getState().loadingSessions.size).toBe(0);
  });

  it("has historyLoadVersion 0", () => {
    expect(useChatStore.getState().historyLoadVersion).toBe(0);
  });

  it("has empty historyLoadVersionBySession", () => {
    expect(useChatStore.getState().historyLoadVersionBySession).toEqual({});
  });

  it("has empty messageHydrationBySession", () => {
    expect(useChatStore.getState().messageHydrationBySession).toEqual({});
  });

  it("has empty hasMoreMessagesBySession", () => {
    expect(useChatStore.getState().hasMoreMessagesBySession).toEqual({});
  });

  it("has empty isLoadingMoreBySession", () => {
    expect(useChatStore.getState().isLoadingMoreBySession).toEqual({});
  });
});

describe("setInputText", () => {
  it("sets input text to a value", () => {
    useChatStore.getState().setInputText("hello world");
    expect(useChatStore.getState().inputText).toBe("hello world");
  });

  it("overwrites previous value", () => {
    useChatStore.getState().setInputText("first");
    useChatStore.getState().setInputText("second");
    expect(useChatStore.getState().inputText).toBe("second");
  });

  it("can clear input", () => {
    useChatStore.getState().setInputText("some text");
    useChatStore.getState().setInputText("");
    expect(useChatStore.getState().inputText).toBe("");
  });
});

describe("isStreaming toggle via setIsStreaming", () => {
  it("sets isStreaming to true", () => {
    useChatStore.getState().setIsStreaming(true);
    expect(useChatStore.getState().isStreaming).toBe(true);
  });

  it("sets isStreaming back to false", () => {
    useChatStore.getState().setIsStreaming(true);
    useChatStore.getState().setIsStreaming(false);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });
});

describe("streamContentVersion via incrementStreamVersion", () => {
  it("increments by 1 from initial 0", () => {
    useChatStore.getState().incrementStreamVersion();
    expect(useChatStore.getState().streamContentVersion).toBe(1);
  });

  it("increments multiple times", () => {
    useChatStore.getState().incrementStreamVersion();
    useChatStore.getState().incrementStreamVersion();
    useChatStore.getState().incrementStreamVersion();
    expect(useChatStore.getState().streamContentVersion).toBe(3);
  });
});

describe("loadingSessions via setState", () => {
  it("can add a session to loading set", () => {
    const next = new Set(useChatStore.getState().loadingSessions);
    next.add("sess-a");
    useChatStore.setState({ loadingSessions: next });

    expect(useChatStore.getState().loadingSessions.has("sess-a")).toBe(true);
  });

  it("can remove a session from loading set", () => {
    const withSession = new Set<string>(["sess-a", "sess-b"]);
    useChatStore.setState({ loadingSessions: withSession });

    const after = new Set(useChatStore.getState().loadingSessions);
    after.delete("sess-a");
    useChatStore.setState({ loadingSessions: after });

    expect(useChatStore.getState().loadingSessions.has("sess-a")).toBe(false);
    expect(useChatStore.getState().loadingSessions.has("sess-b")).toBe(true);
  });
});

describe("historyLoadVersion via setState", () => {
  it("can be incremented via setState", () => {
    useChatStore.setState((s) => ({ historyLoadVersion: s.historyLoadVersion + 1 }));
    expect(useChatStore.getState().historyLoadVersion).toBe(1);
  });

  it("increments independently of other state", () => {
    useChatStore.getState().setInputText("text");
    useChatStore.setState((s) => ({ historyLoadVersion: s.historyLoadVersion + 2 }));
    expect(useChatStore.getState().historyLoadVersion).toBe(2);
    expect(useChatStore.getState().inputText).toBe("text");
  });
});

describe("hasMoreMessagesBySession via setState", () => {
  it("can set hasMore for a session", () => {
    useChatStore.setState({ hasMoreMessagesBySession: { "sess-1": true } });
    expect(useChatStore.getState().hasMoreMessagesBySession["sess-1"]).toBe(true);
  });

  it("can update hasMore for multiple sessions", () => {
    useChatStore.setState({
      hasMoreMessagesBySession: { "sess-1": true, "sess-2": false },
    });
    expect(useChatStore.getState().hasMoreMessagesBySession["sess-1"]).toBe(true);
    expect(useChatStore.getState().hasMoreMessagesBySession["sess-2"]).toBe(false);
  });
});

describe("isLoadingMoreBySession via setState", () => {
  it("can set isLoadingMore for a session", () => {
    useChatStore.setState({ isLoadingMoreBySession: { "sess-1": true } });
    expect(useChatStore.getState().isLoadingMoreBySession["sess-1"]).toBe(true);
  });

  it("can clear isLoadingMore after loading", () => {
    useChatStore.setState({ isLoadingMoreBySession: { "sess-1": true } });
    useChatStore.setState((s) => ({
      isLoadingMoreBySession: { ...s.isLoadingMoreBySession, "sess-1": false },
    }));
    expect(useChatStore.getState().isLoadingMoreBySession["sess-1"]).toBe(false);
  });
});

describe("messagesBySession via setMessagesForSession", () => {
  it("sets messages for a new session", () => {
    const msgs: ChatMessage[] = [
      { id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ];
    useChatStore.getState().setMessagesForSession("sess-new", msgs);
    expect(useChatStore.getState().messagesBySession["sess-new"]).toEqual(msgs);
  });

  it("does not affect other sessions", () => {
    useChatStore
      .getState()
      .setMessagesForSession("sess-a", [
        { id: "m1", role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 },
      ]);
    useChatStore
      .getState()
      .setMessagesForSession("sess-b", [
        { id: "m2", role: "user", content: [{ type: "text", text: "b" }], timestamp: 2 },
      ]);

    expect(useChatStore.getState().messagesBySession["sess-a"]).toHaveLength(1);
    expect(useChatStore.getState().messagesBySession["sess-b"]).toHaveLength(1);
  });
});

describe("normalizeToolBlocks — edge cases", () => {
  it("handles empty array without error", () => {
    const msgs: ChatMessage[] = [];
    expect(() => normalizeToolBlocks(msgs)).not.toThrow();
    expect(msgs).toHaveLength(0);
  });

  it("preserves user messages unchanged", () => {
    const msgs: ChatMessage[] = [
      { id: "u1", role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
    ];
    normalizeToolBlocks(msgs);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toEqual({ type: "text", text: "hello" });
  });

  it("handles assistant message with text-only content", () => {
    const msgs: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "response" }],
        timestamp: 1,
      },
    ];
    normalizeToolBlocks(msgs);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content[0]).toEqual({ type: "text", text: "response" });
  });

  it("removes toolResult message even when no matching toolCall exists", () => {
    const msgs: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "thinking..." }],
        timestamp: 1,
      },
      {
        id: "r1",
        role: "toolResult",
        content: [
          {
            type: "toolResult",
            toolCallId: "tc-missing",
            toolName: "custom-tool",
            content: "result",
          },
        ],
        timestamp: 2,
      },
    ];
    normalizeToolBlocks(msgs);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("a1");
  });

  it("handles object input with description field", () => {
    const msgs: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc-desc",
            name: "read",
            input: { path: "file.ts", description: "Read a file" },
          },
        ],
        timestamp: 1,
      },
      {
        id: "r1",
        role: "toolResult",
        content: [
          {
            type: "toolResult",
            toolCallId: "tc-desc",
            toolName: "read",
            content: "file content",
          },
        ],
        timestamp: 2,
      },
    ];
    normalizeToolBlocks(msgs);
    const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.args).toBe(
      JSON.stringify({ path: "file.ts", description: "Read a file" }, null, 2),
    );
    expect(block.description).toBe("Read a file");
  });

  it("handles toolResult with isError producing error status", () => {
    const msgs: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-err", name: "bash", input: "bad" }],
        timestamp: 1,
      },
      {
        id: "r1",
        role: "toolResult",
        content: [
          {
            type: "toolResult",
            toolCallId: "tc-err",
            toolName: "bash",
            content: "command failed",
            isError: true,
          },
        ],
        timestamp: 2,
      },
    ];
    normalizeToolBlocks(msgs);
    const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.status).toBe("error");
    expect(block.output).toBe("command failed");
  });
});

describe("addMessage with no active session", () => {
  it("does nothing when activeSessionId is null", async () => {
    const { useSessionStore: sessionStore } =
      await import("../src/mainview/stores/use-session-store");
    const mockedGetState = vi.mocked(sessionStore.getState);
    mockedGetState.mockReturnValueOnce({
      activeSessionId: null,
      sessionReady: {},
      sessionContextMap: {},
      restoreContextFromHistory: vi.fn(),
    });

    const msg: ChatMessage = {
      id: "msg-1",
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    };
    useChatStore.getState().addMessage(msg);

    expect(Object.keys(useChatStore.getState().messagesBySession)).toHaveLength(0);
  });
});
