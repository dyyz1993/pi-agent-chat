import { describe, it, expect, beforeEach, vi } from "vitest";

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
      restoreContextFromHistory: vi.fn(),
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

vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result", "memory_inject"]),
}));

import { useChatStore, normalizeToolBlocks } from "../../../src/mainview/stores/use-chat-store";
import { apiClient } from "../../../src/mainview/lib/api-client";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";

beforeEach(() => {
  vi.clearAllMocks();
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

describe("setInputText", () => {
  it("sets input text", () => {
    useChatStore.getState().setInputText("hello");
    expect(useChatStore.getState().inputText).toBe("hello");
  });

  it("clears input text", () => {
    useChatStore.getState().setInputText("hello");
    useChatStore.getState().setInputText("");
    expect(useChatStore.getState().inputText).toBe("");
  });
});

describe("addMessage", () => {
  it("adds message to active session", () => {
    const msg: ChatMessage = {
      id: "msg-1",
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: Date.now(),
    };
    useChatStore.getState().addMessage(msg);

    const state = useChatStore.getState();
    expect(state.messagesBySession["sess-1"]).toHaveLength(1);
    expect(state.messagesBySession["sess-1"][0].id).toBe("msg-1");
  });

  it("appends messages", () => {
    const msg1: ChatMessage = {
      id: "m1",
      role: "user",
      content: [{ type: "text", text: "a" }],
      timestamp: 1,
    };
    const msg2: ChatMessage = {
      id: "m2",
      role: "user",
      content: [{ type: "text", text: "b" }],
      timestamp: 2,
    };

    useChatStore.getState().addMessage(msg1);
    useChatStore.getState().addMessage(msg2);

    expect(useChatStore.getState().messagesBySession["sess-1"]).toHaveLength(2);
  });
});

describe("setMessagesForSession", () => {
  it("sets messages for a specific session", () => {
    const msgs: ChatMessage[] = [
      { id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ];
    useChatStore.getState().setMessagesForSession("sess-1", msgs);

    expect(useChatStore.getState().messagesBySession["sess-1"]).toEqual(msgs);
  });

  it("replaces existing messages", () => {
    useChatStore
      .getState()
      .setMessagesForSession("sess-1", [
        { id: "old", role: "user", content: [{ type: "text", text: "old" }], timestamp: 1 },
      ]);
    useChatStore
      .getState()
      .setMessagesForSession("sess-1", [
        { id: "new", role: "user", content: [{ type: "text", text: "new" }], timestamp: 2 },
      ]);

    expect(useChatStore.getState().messagesBySession["sess-1"]).toHaveLength(1);
    expect(useChatStore.getState().messagesBySession["sess-1"][0].id).toBe("new");
  });

  it("deduplicates memory inject custom messages at the store write gateway", () => {
    const data = {
      operationId: "op-1",
      fingerprint: "a.md,b.md|1741",
      selectedFiles: ["a.md", "b.md"],
      injectedBytes: 1741,
    };

    useChatStore.getState().setMessagesForSession("sess-1", [
      {
        id: "inject-1",
        role: "custom",
        content: [{ type: "custom", customType: "memory_inject", data }],
        timestamp: 1,
      },
      {
        id: "save-memory",
        role: "custom",
        content: [{ type: "custom", customType: "memory_extract_result", data: {} }],
        timestamp: 2,
      },
      {
        id: "inject-2",
        role: "custom",
        content: [{ type: "custom", customType: "memory_inject", data }],
        timestamp: 3,
      },
    ]);

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages.map((message) => message.id)).toEqual(["inject-1", "save-memory"]);
  });

  it("normalizes toolCall and toolResult through the store write gateway", () => {
    useChatStore.getState().setMessagesForSession("sess-1", [
      {
        id: "assistant-tool",
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-1", name: "bash", input: "echo ok" }],
        timestamp: 1,
      },
      {
        id: "tool-result",
        role: "toolResult",
        content: [
          { type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "ok" },
        ],
        timestamp: 2,
      },
    ]);

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages).toHaveLength(1);
    const block = messages[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.type).toBe("toolExecution");
    expect(block.status).toBe("done");
    expect(block.output).toBe("ok");
  });

  it("closes stale running tools that are no longer in the latest streaming assistant", () => {
    useChatStore.getState().setMessagesForSession("sess-1", [
      {
        id: "old-assistant",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "stale-tool",
            toolName: "bash",
            args: "npm test",
            status: "running",
          },
        ],
        timestamp: 1,
        isStreaming: true,
      },
      {
        id: "new-assistant",
        role: "assistant",
        content: [{ type: "text", text: "next message" }],
        timestamp: 2,
        isStreaming: true,
      },
    ]);

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    const oldBlock = messages[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(oldBlock.status).toBe("done");
    expect(messages[0].isStreaming).toBe(false);
  });

  it("keeps the latest streaming assistant tool running", () => {
    useChatStore.getState().setMessagesForSession("sess-1", [
      {
        id: "current-assistant",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "active-tool",
            toolName: "bash",
            args: "npm test",
            status: "running",
          },
        ],
        timestamp: 1,
        isStreaming: true,
      },
    ]);

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    const block = messages[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.status).toBe("running");
    expect(messages[0].isStreaming).toBe(true);
  });

  it("closes latest streaming assistant tools when the active tool snapshot is empty", () => {
    useChatStore.getState().setActiveToolCallIds("sess-1", []);
    useChatStore.getState().setMessagesForSession("sess-1", [
      {
        id: "live-stale",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "stale-tool",
            toolName: "bash",
            args: "cargo test",
            status: "running",
          },
        ],
        timestamp: 1,
        isStreaming: true,
      },
    ]);

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    const block = messages[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.status).toBe("done");
  });

  it("reprocesses existing messages when active tool snapshot arrives after messages", () => {
    useChatStore.getState().setMessagesForSession("sess-1", [
      {
        id: "loaded-before-state",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "stale-tool",
            toolName: "bash",
            args: "cargo test",
            status: "running",
          },
        ],
        timestamp: 1,
        isStreaming: true,
      },
    ]);

    let messages = useChatStore.getState().messagesBySession["sess-1"];
    let block = messages[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.status).toBe("running");

    useChatStore.getState().setActiveToolCallIds("sess-1", []);

    messages = useChatStore.getState().messagesBySession["sess-1"];
    block = messages[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.status).toBe("done");
    expect(messages[0].isStreaming).toBe(false);
  });
});

describe("clearSessionMessages", () => {
  it("removes messages for a session", () => {
    useChatStore
      .getState()
      .setMessagesForSession("sess-1", [
        { id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      ]);
    useChatStore
      .getState()
      .setMessagesForSession("sess-2", [
        { id: "m2", role: "user", content: [{ type: "text", text: "there" }], timestamp: 2 },
      ]);

    useChatStore.getState().clearSessionMessages("sess-1");

    expect(useChatStore.getState().messagesBySession["sess-1"]).toBeUndefined();
    expect(useChatStore.getState().messagesBySession["sess-2"]).toHaveLength(1);
  });
});

describe("setIsStreaming / incrementStreamVersion", () => {
  it("toggles streaming state", () => {
    useChatStore.getState().setIsStreaming(true);
    expect(useChatStore.getState().isStreaming).toBe(true);
    useChatStore.getState().setIsStreaming(false);
    expect(useChatStore.getState().isStreaming).toBe(false);
  });

  it("increments stream version", () => {
    const v0 = useChatStore.getState().streamContentVersion;
    useChatStore.getState().incrementStreamVersion();
    expect(useChatStore.getState().streamContentVersion).toBe(v0 + 1);
  });
});

describe("loadSessionMessages custom entry recovery", () => {
  it("hydrates bash background process custom entries after refresh", async () => {
    vi.mocked(apiClient.call).mockResolvedValue({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "run background task" }],
          timestamp: 100,
        },
      ],
      customEntries: [
        {
          id: "bg-1",
          customType: "bash_background_process",
          data: {
            bashId: "bash-fabe60",
            command: "/tmp/cumulative_sum_test.sh",
            status: "done",
            reason: "exit_zero",
            backgroundTrigger: "auto",
            duration: "1m0s",
          },
          timestamp: 200,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages("sess-1", { force: true });

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      id: "bg-1",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "bash_background_process",
        },
      ],
    });
  });

  it("merges memory prefetch start/result by operationId after refresh", async () => {
    vi.mocked(apiClient.call).mockResolvedValue({
      messages: [],
      customEntries: [
        {
          id: "prefetch-start-1",
          customType: "memory_prefetch",
          data: {
            operationId: "op-1",
            query: "find related memory",
            availableFiles: 7,
          },
          timestamp: 100,
        },
        {
          id: "prefetch-result-1",
          customType: "memory_prefetch_result",
          data: {
            operationId: "op-1",
            summary: "Injected relevant memories",
            snippet: "memory text",
            injectedBytes: 2048,
            selectedFiles: ["a.md"],
          },
          timestamp: 200,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages("sess-1", { force: true });

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "prefetch-result-1",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "memory_prefetch_result",
          data: {
            operationId: "op-1",
            _prefetchQuery: "find related memory",
            _prefetchAvailableFiles: 7,
          },
        },
      ],
    });
  });

  it("anchors merged memory prefetch result after the triggering user message after refresh", async () => {
    vi.mocked(apiClient.call).mockResolvedValue({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "读取一下上面的文件" }],
          timestamp: 1_000,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "我来处理。" }],
          timestamp: 3_000,
        },
      ],
      customEntries: [
        {
          id: "prefetch-start-1",
          customType: "memory_prefetch",
          data: {
            operationId: "op-1",
            query: "读取一下上面的文件",
            availableFiles: 2,
            occurredAt: 1_100,
            phaseOrder: 1,
          },
          timestamp: 5_000,
        },
        {
          id: "prefetch-result-1",
          customType: "memory_prefetch_result",
          data: {
            operationId: "op-1",
            summary: "Matched memory",
            snippet: "memory text",
            injectedBytes: 435,
            selectedFiles: ["MEMORY.md"],
            occurredAt: 1_200,
            phaseOrder: 2,
          },
          timestamp: 5_100,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages("sess-1", { force: true });

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages.map((message) => message.role)).toEqual(["user", "custom", "assistant"]);
    expect(messages[1]).toMatchObject({
      id: "prefetch-result-1",
      timestamp: 1_100,
      content: [
        {
          type: "custom",
          customType: "memory_prefetch_result",
          data: {
            operationId: "op-1",
            _prefetchOccurredAt: 1_100,
          },
        },
      ],
    });
  });

  it("does not merge memory prefetch entries without matching operationId", async () => {
    vi.mocked(apiClient.call).mockResolvedValue({
      messages: [],
      customEntries: [
        {
          id: "prefetch-start-1",
          customType: "memory_prefetch",
          data: {
            operationId: "op-1",
            query: "first",
            availableFiles: 1,
          },
          timestamp: 100,
        },
        {
          id: "prefetch-result-2",
          customType: "memory_prefetch_result",
          data: {
            operationId: "op-2",
            summary: "No relevant memories",
            snippet: "",
          },
          timestamp: 200,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages("sess-1", { force: true });

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.id)).toEqual(["prefetch-start-1", "prefetch-result-2"]);
  });

  it("deduplicates repeated memory inject entries by operation fingerprint after refresh", async () => {
    const injectData = {
      operationId: "op-1",
      fingerprint: "a.md,b.md|1741",
      summary: "Injected memory context",
      snippet: "memory text",
      injectedBytes: 1741,
      selectedFiles: ["a.md", "b.md"],
    };
    vi.mocked(apiClient.call).mockResolvedValue({
      messages: [],
      customEntries: [
        {
          id: "inject-1",
          customType: "memory_inject",
          data: injectData,
          timestamp: 100,
        },
        {
          id: "inject-2",
          customType: "memory_inject",
          data: injectData,
          timestamp: 110,
        },
        {
          id: "inject-3",
          customType: "memory_inject",
          data: injectData,
          timestamp: 120,
        },
      ],
      hasMore: false,
    });

    await useChatStore.getState().loadSessionMessages("sess-1", { force: true });

    const messages = useChatStore.getState().messagesBySession["sess-1"];
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "inject-1",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "memory_inject",
        },
      ],
    });
  });
});

describe("streamVersionBySession (per-session isolation)", () => {
  beforeEach(() => {
    useChatStore.setState({ streamVersionBySession: {} });
  });

  it("bumpStreamVersion increments only the target session's per-session version", () => {
    useChatStore.getState().setMessagesForSession("sess-A", [
      { id: "m1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
    ], { bumpStreamVersion: true });

    const state = useChatStore.getState();
    expect(state.streamVersionBySession["sess-A"]).toBe(1);
    expect(state.streamVersionBySession["sess-B"]).toBeUndefined();
  });

  it("updating sess-A does not change sess-B's per-session version", () => {
    // Prime both sessions
    useChatStore.getState().setMessagesForSession("sess-A", [
      { id: "a1", role: "user", content: [{ type: "text", text: "A" }], timestamp: 1 },
    ], { bumpStreamVersion: true });
    useChatStore.getState().setMessagesForSession("sess-B", [
      { id: "b1", role: "user", content: [{ type: "text", text: "B" }], timestamp: 2 },
    ], { bumpStreamVersion: true });

    expect(useChatStore.getState().streamVersionBySession["sess-A"]).toBe(1);
    expect(useChatStore.getState().streamVersionBySession["sess-B"]).toBe(1);

    // Update only sess-A again
    useChatStore.getState().setMessagesForSession("sess-A", [
      { id: "a2", role: "user", content: [{ type: "text", text: "A2" }], timestamp: 3 },
    ], { bumpStreamVersion: true });

    const map = useChatStore.getState().streamVersionBySession;
    expect(map["sess-A"]).toBe(2);
    expect(map["sess-B"]).toBe(1); // unchanged
  });

  it("setMessagesForSession without bumpStreamVersion does not touch per-session version", () => {
    useChatStore.getState().setMessagesForSession("sess-A", [
      { id: "a1", role: "user", content: [{ type: "text", text: "A" }], timestamp: 1 },
    ]);
    expect(useChatStore.getState().streamVersionBySession["sess-A"]).toBeUndefined();
  });

  it("global streamContentVersion still increments for backward compat", () => {
    const v0 = useChatStore.getState().streamContentVersion;
    useChatStore.getState().setMessagesForSession("sess-A", [
      { id: "a1", role: "user", content: [{ type: "text", text: "A" }], timestamp: 1 },
    ], { bumpStreamVersion: true });
    expect(useChatStore.getState().streamContentVersion).toBe(v0 + 1);
  });
});

describe("normalizeToolBlocks", () => {
  it("merges toolCall and toolResult into toolExecution (done)", () => {
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-1", name: "bash", input: "echo hi" }],
        timestamp: 1,
      },
      {
        id: "m2",
        role: "toolResult",
        content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "hi" }],
        timestamp: 2,
      },
    ];

    normalizeToolBlocks(msgs);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.type).toBe("toolExecution");
    expect(block.toolCallId).toBe("tc-1");
    expect(block.toolName).toBe("bash");
    expect(block.status).toBe("done");
    expect(block.output).toBe("hi");
  });

  it("marks toolExecution as error when toolResult has isError", () => {
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-1", name: "bash", input: "fail" }],
        timestamp: 1,
      },
      {
        id: "m2",
        role: "toolResult",
        content: [
          {
            type: "toolResult",
            toolCallId: "tc-1",
            toolName: "bash",
            content: "error!",
            isError: true,
          },
        ],
        timestamp: 2,
      },
    ];

    normalizeToolBlocks(msgs);

    const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.status).toBe("error");
  });

  it("converts unmatched toolCall to toolExecution with running status", () => {
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [{ type: "toolCall", id: "tc-orphan", name: "read", input: "file.ts" }],
        timestamp: 1,
      },
    ];

    normalizeToolBlocks(msgs);

    const block = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(block.type).toBe("toolExecution");
    expect(block.status).toBe("running");
  });

  it("handles multiple toolCalls with corresponding toolResults", () => {
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc-1", name: "bash", input: "echo a" },
          { type: "toolCall", id: "tc-2", name: "bash", input: "echo b" },
        ],
        timestamp: 1,
      },
      {
        id: "m2",
        role: "toolResult",
        content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "a" }],
        timestamp: 2,
      },
      {
        id: "m3",
        role: "toolResult",
        content: [{ type: "toolResult", toolCallId: "tc-2", toolName: "bash", content: "b" }],
        timestamp: 3,
      },
    ];

    normalizeToolBlocks(msgs);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toHaveLength(2);
    const b1 = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    const b2 = msgs[0].content[1] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(b1.status).toBe("done");
    expect(b1.output).toBe("a");
    expect(b2.status).toBe("done");
    expect(b2.output).toBe("b");
  });

  it("preserves non-tool content blocks", () => {
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
          { type: "toolCall", id: "tc-1", name: "bash", input: "echo hi" },
        ],
        timestamp: 1,
      },
      {
        id: "m2",
        role: "toolResult",
        content: [{ type: "toolResult", toolCallId: "tc-1", toolName: "bash", content: "hi" }],
        timestamp: 2,
      },
    ];

    normalizeToolBlocks(msgs);

    expect(msgs[0].content[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("deduplicates live toolExecution blocks against replayed toolCall blocks", () => {
    const msgs: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-live",
            toolName: "bash",
            args: "cat .env.local",
            status: "running",
            output: "waiting...",
          },
          { type: "toolCall", id: "tc-live", name: "bash", input: "cat .env.local" },
        ],
        timestamp: 1,
        isStreaming: true,
      },
    ];

    normalizeToolBlocks(msgs, false, true);

    const blocks = msgs[0].content.filter((b) => b.type === "toolExecution") as Extract<
      ContentBlock,
      { type: "toolExecution" }
    >[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("tc-live");
    expect(blocks[0].status).toBe("running");
    expect(blocks[0].output).toBe("waiting...");
    expect(msgs[0].content.some((b) => b.type === "toolCall")).toBe(false);
  });

  it("normalizes raw SDK toolCall arguments shape before rendering", () => {
    const msgs = [
      {
        id: "m1",
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc-raw-bash",
            name: "bash",
            arguments: { command: "npm run build", description: "workspace 全量测试" },
          },
        ],
        timestamp: 1,
      },
      {
        id: "m2",
        role: "toolResult",
        content: [
          {
            type: "toolResult",
            toolCallId: "tc-raw-bash",
            toolName: "bash",
            content: "passed",
          },
        ],
        timestamp: 2,
      },
    ] as ChatMessage[];

    normalizeToolBlocks(msgs);

    expect(msgs).toHaveLength(1);
    const block = msgs[0].content[0];
    expect(block.type).toBe("toolExecution");
    if (block.type === "toolExecution") {
      expect(block.toolCallId).toBe("tc-raw-bash");
      expect(block.status).toBe("done");
      expect(block.args).toContain("npm run build");
      expect(block.description).toBe("workspace 全量测试");
    }
  });

  it("keeps informative orphan toolResults for historical recovery", () => {
    const msgs: ChatMessage[] = [
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "查看结果" }],
        timestamp: 1,
      },
      {
        id: "r1",
        role: "toolResult",
        content: [
          {
            type: "toolResult",
            toolCallId: "tc-missing",
            toolName: "bash",
            content: "real output",
          },
        ],
        timestamp: 2,
      },
    ];

    normalizeToolBlocks(msgs);

    expect(msgs).toHaveLength(1);
    const exec = msgs[0].content[1] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec.type).toBe("toolExecution");
    expect(exec.toolName).toBe("bash");
    expect(exec.output).toBe("real output");
  });

});

describe("session isolation", () => {
  it("messages for different sessions do not interfere", () => {
    useChatStore
      .getState()
      .setMessagesForSession("sess-1", [
        { id: "m1", role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 },
      ]);
    useChatStore
      .getState()
      .setMessagesForSession("sess-2", [
        { id: "m2", role: "user", content: [{ type: "text", text: "b" }], timestamp: 2 },
      ]);

    useChatStore.getState().clearSessionMessages("sess-1");

    expect(useChatStore.getState().messagesBySession["sess-1"]).toBeUndefined();
    expect(useChatStore.getState().messagesBySession["sess-2"]).toHaveLength(1);
  });
});
