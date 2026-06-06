import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../src/mainview/stores/use-session-store", () => {
  const state: Record<string, unknown> = {
    activeSessionId: "test-session",
    sessionReady: { "test-session": true },
    sessionStatusMap: {},
    clearAgentStarted: () => {},
    restoreContextFromHistory: vi.fn(),
  };
  return {
    useSessionStore: {
      getState: () => state,
      setState: (patch: Record<string, unknown>) => Object.assign(state, patch),
    },
  };
});

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({ addEvent: vi.fn(), addInjected: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({ activeSubsessionId: null }) },
}));

vi.mock("../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: () => ({}) },
}));

vi.mock("../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: () => ({}) },
  deriveSkillScope: vi.fn(),
  derivePluginScope: vi.fn(),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({ setNavId: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({ setActive: vi.fn() }) },
}));

vi.mock("../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: vi.fn(),
  syncTabsToBackend: vi.fn(),
}));

import { apiClient } from "../src/mainview/lib/api-client";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";

const PAGE_SIZE = 50;

function makeRawMessage(index: number, role: "user" | "assistant" = "user") {
  return {
    id: `msg-${index}`,
    entryId: `entry-${index}`,
    role,
    content: [{ type: "text", text: `Message ${index}` }],
    timestamp: 1000 + index * 100,
  };
}

function makeRawAssistantToolCallMessage(index: number, toolCallId: string) {
  return {
    id: `msg-${index}`,
    entryId: `entry-${index}`,
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: toolCallId,
        name: "bash",
        arguments: { command: "npm run build", description: "build" },
      },
    ],
    timestamp: 1000 + index * 100,
  };
}

function makeRawToolResultMessage(index: number, toolCallId: string, content: string) {
  return {
    id: `tool-result-${index}`,
    entryId: `tool-result-entry-${index}`,
    role: "toolResult",
    toolCallId,
    toolName: "bash",
    content: [{ type: "text", text: content }],
    timestamp: 1000 + index * 100 + 1,
  };
}

function makeRpcResult(count: number, startIndex = 0) {
  const messages = [];
  for (let i = 0; i < count; i++) {
    messages.push(
      makeRawMessage(startIndex + i, (startIndex + i) % 2 === 0 ? "user" : "assistant"),
    );
  }
  return { messages, customEntries: [] };
}

async function flushBackgroundRefresh() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("chat pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      messagesBySession: {},
      inputText: "",
      isStreaming: false,
      streamContentVersion: 0,
      loadingSessions: new Set(),
      historyLoadVersion: 0,
      hasMoreMessagesBySession: {},
      isLoadingMoreBySession: {},
      nextCursorBySession: {},
    });
    useSessionStore.setState({
      activeSessionId: "test-session",
      sessionReady: { "test-session": true },
      sessionStatusMap: {},
      restoreContextFromHistory: vi.fn(),
    });
  });

  it("initial load should request only recent N messages", async () => {
    const allMessages = makeRpcResult(120);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"];
    expect(msgs).toBeDefined();
    expect(msgs.length).toBeLessThanOrEqual(120);
    expect(apiClient.call).toHaveBeenCalledWith(
      "agent.getFullMessages",
      expect.objectContaining({ sessionId: "test-session" }),
    );
  });

  it("initial historical load should not mark orphan tool calls as running while session streams", async () => {
    useSessionStore.setState({
      sessionStatusMap: { "test-session": "streaming" },
    });
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [makeRawAssistantToolCallMessage(1, "tc-historical-refresh")],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadSessionMessages("test-session", { force: true });

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const block = msgs[0].content[0];
    expect(block.type).toBe("toolExecution");
    if (block.type === "toolExecution") {
      expect(block.toolCallId).toBe("tc-historical-refresh");
      expect(block.status).toBe("unknown");
    }
  });

  it("loadMoreMessages should prepend older messages", async () => {
    const allMessages = makeRpcResult(100);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages.slice(-PAGE_SIZE),
      customEntries: [],
      hasMore: true,
      nextCursor: "entry-50",
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const initialMsgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(initialMsgs.length).toBe(PAGE_SIZE);

    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(true);
    expect(useChatStore.getState().nextCursorBySession!["test-session"]).toBe("entry-50");

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadMoreMessages!("test-session");

    expect(apiClient.call).toHaveBeenLastCalledWith(
      "agent.getFullMessages",
      expect.objectContaining({
        sessionId: "test-session",
        limit: PAGE_SIZE,
        afterEntryId: "entry-50",
      }),
    );

    const afterLoadMore = useChatStore.getState().messagesBySession["test-session"]!;
    expect(afterLoadMore.length).toBe(100);
    expect(afterLoadMore[0].id).toBe("msg-0");
    expect(afterLoadMore[PAGE_SIZE].id).toBe(`msg-${PAGE_SIZE}`);
  });

  it("loadMoreMessages should not turn older orphan tool calls into running cards", async () => {
    const currentMessage = makeRawMessage(10, "assistant");
    useChatStore.setState({
      messagesBySession: { "test-session": [currentMessage] },
      hasMoreMessagesBySession: { "test-session": true },
      nextCursorBySession: { "test-session": "entry-10" },
    });
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [makeRawAssistantToolCallMessage(1, "tc-load-more-orphan")],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadMoreMessages!("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const loaded = msgs.find((msg) => msg.id === "msg-1");
    expect(loaded).toBeDefined();
    const block = loaded!.content[0];
    expect(block.type).toBe("toolExecution");
    if (block.type === "toolExecution") {
      expect(block.toolCallId).toBe("tc-load-more-orphan");
      expect(block.status).toBe("unknown");
    }
  });

  it("loadMoreMessages should let server history replace stale running cards with the same message id", async () => {
    useChatStore.setState({
      messagesBySession: {
        "test-session": [
          {
            id: "msg-1",
            entryId: "entry-1",
            role: "assistant",
            content: [
              {
                type: "toolExecution",
                toolCallId: "tc-overlap-commit",
                toolName: "bash",
                args: JSON.stringify({ command: "git commit", description: "commit" }),
                status: "running",
                output: "waiting...",
              },
            ],
            timestamp: 1100,
            isStreaming: true,
          },
        ],
      },
      hasMoreMessagesBySession: { "test-session": true },
      nextCursorBySession: { "test-session": "entry-1" },
    });
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        makeRawAssistantToolCallMessage(1, "tc-overlap-commit"),
        makeRawToolResultMessage(1, "tc-overlap-commit", "[main f862e26] committed"),
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadMoreMessages!("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const loaded = msgs.find((msg) => msg.id === "msg-1");
    expect(loaded).toBeDefined();
    const block = loaded!.content[0];
    expect(block.type).toBe("toolExecution");
    if (block.type === "toolExecution") {
      expect(block.toolCallId).toBe("tc-overlap-commit");
      expect(block.status).not.toBe("running");
      expect(block.output).not.toBe("waiting...");
    }
  });

  it("should not request more when hasMoreMessages is false", async () => {
    const allMessages = makeRpcResult(30);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const initialMsgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(initialMsgs.length).toBe(30);

    const callCount = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(false);

    await useChatStore.getState().loadMoreMessages!("test-session");

    expect((apiClient.call as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });

  it("new messages should append to bottom without affecting pagination", async () => {
    const allMessages = makeRpcResult(30);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: allMessages.messages,
      customEntries: [],
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const newMsg = {
      id: "msg-new-1",
      role: "user" as const,
      content: [{ type: "text" as const, text: "New message" }],
      timestamp: Date.now(),
    };
    useChatStore.getState().addMessage(newMsg);

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(msgs.length).toBe(31);
    expect(msgs[msgs.length - 1].id).toBe("msg-new-1");
    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(false);
  });

  it("background refresh should replace non-local live duplicates with server messages", async () => {
    useChatStore.getState().setMessagesForSession("test-session", [
      {
        id: "live-assistant-ok",
        role: "assistant",
        content: [{ type: "text", text: "OK" }],
        timestamp: 2000,
      },
    ]);

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        {
          id: "server-assistant-ok",
          entryId: "entry-server-assistant-ok",
          role: "assistant",
          content: [{ type: "text", text: "OK" }],
          timestamp: 2000,
        },
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.getState()._backgroundRefreshMessages("test-session");

    await flushBackgroundRefresh();

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("server-assistant-ok");
  });

  it("background refresh should close stale running tool cards while preserving the latest live stream", async () => {
    useChatStore.getState().setMessagesForSession("test-session", [
      {
        id: "stale-running-tool",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-stale-commit",
            toolName: "bash",
            args: JSON.stringify({ command: "git commit -m M3.4", description: "commit M3.4" }),
            status: "running",
            output: "waiting...",
          },
        ],
        timestamp: 1100,
        isStreaming: true,
      },
      {
        id: "latest-live-tool",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-latest-read",
            toolName: "read",
            args: JSON.stringify({ path: "ROADMAP.md" }),
            status: "running",
          },
        ],
        timestamp: 2200,
        isStreaming: true,
      },
    ]);

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        makeRawAssistantToolCallMessage(1, "tc-stale-commit"),
        makeRawToolResultMessage(1, "tc-stale-commit", "[main f862e26] M3.4"),
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.getState()._backgroundRefreshMessages("test-session");

    await flushBackgroundRefresh();

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const toolBlocks = msgs.flatMap((msg) =>
      msg.content.filter((block) => block.type === "toolExecution"),
    );
    const staleBlocks = toolBlocks.filter(
      (block) => block.type === "toolExecution" && block.toolCallId === "tc-stale-commit",
    );
    const liveBlock = toolBlocks.find(
      (block) => block.type === "toolExecution" && block.toolCallId === "tc-latest-read",
    );

    expect(staleBlocks.length).toBeGreaterThan(0);
    expect(liveBlock).toBeDefined();
    expect(
      staleBlocks.some((block) => block.type === "toolExecution" && block.status === "running"),
    ).toBe(false);
    if (liveBlock?.type === "toolExecution") {
      expect(liveBlock.status).toBe("running");
    }
  });

  it("background refresh should preserve optimistic local user messages", async () => {
    useChatStore.getState().setMessagesForSession("test-session", [
      {
        id: "local-user-msg",
        role: "user",
        content: [{ type: "text", text: "Pending local message" }],
        timestamp: 3000,
        _local: true,
      },
    ]);

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        {
          id: "server-assistant-ok",
          entryId: "entry-server-assistant-ok",
          role: "assistant",
          content: [{ type: "text", text: "OK" }],
          timestamp: 2000,
        },
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.getState()._backgroundRefreshMessages("test-session");

    await flushBackgroundRefresh();

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(msgs.map((m) => m.id)).toEqual(["server-assistant-ok", "local-user-msg"]);
  });

  it("should track hasMoreMessages based on initial load result", async () => {
    const manyMessages = makeRpcResult(200);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: manyMessages.messages.slice(0, PAGE_SIZE),
      customEntries: [],
      hasMore: true,
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    expect(msgs.length).toBe(PAGE_SIZE);
    expect(useChatStore.getState().hasMoreMessagesBySession!["test-session"]).toBe(true);
  });

  it("isLoadingMore should be true during loadMoreMessages and false after", async () => {
    const manyMessages = makeRpcResult(200);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: manyMessages.messages.slice(0, PAGE_SIZE),
      customEntries: [],
      hasMore: true,
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    let resolveLoadMore: () => void = () => {};
    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((r) => {
          resolveLoadMore = () =>
            r({ messages: manyMessages.messages, customEntries: [], hasMore: false });
        }),
    );

    const promise = useChatStore.getState().loadMoreMessages!("test-session");

    expect(useChatStore.getState().isLoadingMoreBySession!["test-session"]).toBe(true);

    resolveLoadMore();
    await promise;

    expect(useChatStore.getState().isLoadingMoreBySession!["test-session"]).toBe(false);
  });
});
