import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentBlock } from "../../../src/mainview/types";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  const state: Record<string, unknown> = {
    activeSessionId: "test-session",
    sessionReady: { "test-session": true },
    sessionStatusMap: {},
    sessionsByProject: {},
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

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({ addEvent: vi.fn(), addInjected: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({ activeSubsessionId: null }) },
}));

vi.mock("../../../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: () => ({}) },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: () => ({}) },
  deriveSkillScope: vi.fn(),
  derivePluginScope: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-turn-store", () => ({
  useTurnStore: { getState: () => ({ setNavId: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: { getState: () => ({ setActive: vi.fn() }) },
}));

vi.mock("../../../src/mainview/stores/session-subscriptions", () => ({
  setupSubscriptions: vi.fn(),
  cleanupSession: vi.fn(),
  cleanupSessionData: vi.fn(),
  cleanupSessionLight: vi.fn(),
  clearSubscriptionState: vi.fn(),
  syncTabsToBackend: vi.fn(),
}));

import { apiClient } from "../../../src/mainview/lib/api-client";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";

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
    (apiClient.call as ReturnType<typeof vi.fn>).mockReset();
    (apiClient.subscribe as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue("sub-id");
    (apiClient.unsubscribe as ReturnType<typeof vi.fn>).mockReset();
    (apiClient.onReconnect as ReturnType<typeof vi.fn>).mockReset();
    useChatStore.setState({
      messagesBySession: {},
      inputText: "",
      isStreaming: false,
      streamContentVersion: 0,
      loadingSessions: new Set(),
      historyLoadVersion: 0,
      historyLoadVersionBySession: {},
      messageHydrationBySession: {},
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

  it("initial force load should mark session hydration ready and bump the session version", async () => {
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [makeRawMessage(1, "user")],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadSessionMessages("test-session", { force: true });

    const state = useChatStore.getState();
    expect(state.messageHydrationBySession["test-session"]).toBe("ready");
    expect(state.historyLoadVersion).toBe(1);
    expect(state.historyLoadVersionBySession["test-session"]).toBe(1);
  });

  it("cached load should keep hydration loading until background refresh finishes", async () => {
    let resolveRefresh: (value: unknown) => void = () => {};
    (apiClient.call as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    useChatStore.getState().setMessagesForSession("test-session", [
      {
        id: "cached-user",
        role: "user",
        content: [{ type: "text", text: "cached" }],
        timestamp: 1000,
      },
    ]);

    await useChatStore.getState().loadSessionMessages("test-session");

    expect(useChatStore.getState().messageHydrationBySession["test-session"]).toBe("loading");
    await vi.waitFor(() => {
      expect(apiClient.call).toHaveBeenCalledWith(
        "agent.getFullMessages",
        expect.objectContaining({ sessionId: "test-session" }),
      );
    });
    resolveRefresh({
      messages: [makeRawMessage(1, "user")],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });
    await flushBackgroundRefresh();

    expect(useChatStore.getState().messageHydrationBySession["test-session"]).toBe("ready");
    expect(useChatStore.getState().historyLoadVersionBySession["test-session"]).toBe(1);
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

  it("initial refresh should not preserve a replayed running tool when history has terminal output", async () => {
    useSessionStore.setState({
      sessionStatusMap: { "test-session": "streaming" },
    });
    useChatStore.setState({
      messagesBySession: {
        "test-session": [
          {
            id: "live-running-net-lib",
            entryId: "live-running-net-lib-entry",
            role: "assistant",
            content: [
              {
                type: "toolExecution",
                toolCallId: "tc-live-net-lib",
                toolName: "bash",
                args: "",
                description: "看 net lib.rs",
                status: "running",
                output: "waiting...",
              },
            ],
            timestamp: 3000,
            isStreaming: true,
          },
        ],
      },
    });
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        {
          id: "server-net-lib",
          entryId: "server-net-lib-entry",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-server-net-lib",
              name: "bash",
              arguments: { description: "看 net lib.rs" },
            },
          ],
          timestamp: 1000,
        },
        makeRawToolResultMessage(2, "tc-server-net-lib", "pub struct Client;"),
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadSessionMessages("test-session", { force: true });

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const executions = msgs.flatMap((msg) =>
      msg.content.filter(
        (block): block is Extract<ContentBlock, { type: "toolExecution" }> =>
          block.type === "toolExecution",
      ),
    );
    expect(executions).toHaveLength(1);
    expect(executions[0].toolCallId).toBe("tc-server-net-lib");
    expect(executions[0].status).toBe("done");
    expect(executions[0].output).toBe("pub struct Client;");
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
        afterEntryId: "entry-50",
      }),
    );

    const afterLoadMore = useChatStore.getState().messagesBySession["test-session"]!;
    expect(afterLoadMore.length).toBe(100);
    expect(afterLoadMore[0].id).toBe("msg-0");
    expect(afterLoadMore[PAGE_SIZE].id).toBe(`msg-${PAGE_SIZE}`);
  });

  it("loadMoreMessages keeps message references stable when the loaded page is unchanged", async () => {
    const currentMessages = makeRpcResult(3);
    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: currentMessages.messages,
      customEntries: [],
      hasMore: true,
      nextCursor: "entry-0",
    });

    await useChatStore.getState().loadSessionMessages("test-session");

    const beforeMessages = useChatStore.getState().messagesBySession["test-session"]!;
    const beforeHistoryVersion =
      useChatStore.getState().historyLoadVersionBySession["test-session"];

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: currentMessages.messages,
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState().loadMoreMessages!("test-session");

    const state = useChatStore.getState();
    expect(state.messagesBySession["test-session"]).toBe(beforeMessages);
    expect(state.historyLoadVersionBySession["test-session"]).toBe(beforeHistoryVersion);
    expect(state.hasMoreMessagesBySession["test-session"]).toBe(false);
    expect(state.nextCursorBySession["test-session"]).toBeNull();
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

  it("background refresh should not preserve stale running bash card when server has terminal command with a new id", async () => {
    useChatStore.getState().setMessagesForSession("test-session", [
      {
        id: "live-running-bash",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-live-workspace-test",
            toolName: "bash",
            args: "npm run build",
            status: "running",
            output: "waiting...",
          },
        ],
        timestamp: 1100,
        isStreaming: true,
      },
    ]);

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        {
          id: "server-assistant-workspace-test",
          entryId: "entry-server-assistant-workspace-test",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-server-workspace-test",
              name: "bash",
              arguments: { command: "npm run build", description: "workspace 全量测试" },
            },
          ],
          timestamp: 1100,
        },
        makeRawToolResultMessage(11, "tc-server-workspace-test", "passed"),
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.getState()._backgroundRefreshMessages("test-session");

    await flushBackgroundRefresh();

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const blocks = msgs.flatMap((msg) =>
      msg.content.filter(
        (block): block is Extract<ContentBlock, { type: "toolExecution" }> =>
          block.type === "toolExecution",
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("tc-server-workspace-test");
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("passed");
  });

  it("background refresh should not preserve stale running bash card when only description matches terminal history", async () => {
    useChatStore.getState().setMessagesForSession("test-session", [
      {
        id: "live-running-bash",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-live-commit",
            toolName: "bash",
            args: "",
            description: "commit M7.2.1",
            status: "running",
            output: "waiting...",
          },
        ],
        timestamp: 1100,
        isStreaming: true,
      },
    ]);

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        {
          id: "server-assistant-commit",
          entryId: "entry-server-assistant-commit",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-server-commit",
              name: "bash",
              arguments: { description: "commit M7.2.1" },
            },
          ],
          timestamp: 1200,
        },
        makeRawToolResultMessage(13, "tc-server-commit", "syntax error"),
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    useChatStore.getState()._backgroundRefreshMessages("test-session");

    await flushBackgroundRefresh();

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const blocks = msgs.flatMap((msg) =>
      msg.content.filter(
        (block): block is Extract<ContentBlock, { type: "toolExecution" }> =>
          block.type === "toolExecution",
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("tc-server-commit");
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("syntax error");
  });

  it("background refresh should replace an older stale running tool with completed history", async () => {
    const staleAssistant = {
      id: "stale-live",
      role: "assistant" as const,
      content: [
        {
          type: "toolExecution" as const,
          toolCallId: "tc-gui-build",
          toolName: "bash",
          args: "cargo build -p browser-gui",
          status: "running" as const,
          description: "看 gui 编译错",
        },
      ],
      timestamp: 1500,
      isStreaming: true,
    };
    const laterAssistant = {
      id: "later",
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "M7.5.1" }],
      timestamp: 3000,
    };
    useChatStore.setState({
      messagesBySession: { "test-session": [staleAssistant, laterAssistant] },
      loadingSessions: new Set(),
    });

    (apiClient.call as ReturnType<typeof vi.fn>).mockResolvedValue({
      messages: [
        {
          id: "assistant-tool",
          entryId: "assistant-tool-entry",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-gui-build",
              name: "bash",
              arguments: {
                command: "cargo build -p browser-gui",
                description: "看 gui 编译错",
              },
            },
          ],
          timestamp: 1000,
        },
        makeRawToolResultMessage(2, "tc-gui-build", "Finished dev profile"),
        laterAssistant,
      ],
      customEntries: [],
      hasMore: false,
      nextCursor: null,
    });

    await useChatStore.getState()._backgroundRefreshMessages("test-session");

    const msgs = useChatStore.getState().messagesBySession["test-session"]!;
    const executions = msgs.flatMap((m) =>
      m.content.filter(
        (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
      ),
    );
    expect(executions).toHaveLength(1);
    expect(executions[0].toolCallId).toBe("tc-gui-build");
    expect(executions[0].status).toBe("done");
    expect(msgs.some((m) => m.id === "stale-live")).toBe(false);
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
