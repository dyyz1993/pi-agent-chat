import { describe, it, expect } from "vitest";
import { aggregateTurns, getItemId } from "../src/mainview/lib/turn-aggregator";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";

function makeUserMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "u1",
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: 1000,
    ...overrides,
  };
}

function makeAssistantMsg(
  overrides: Partial<ChatMessage> = {},
  content?: ContentBlock[],
): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    content: content ?? [{ type: "text", text: "response" }],
    timestamp: 2000,
    ...overrides,
  };
}

describe("aggregateTurns", () => {
  it("empty message list returns empty turns and standalone", () => {
    const result = aggregateTurns([]);
    expect(result.turns).toEqual([]);
    expect(result.standalone).toEqual([]);
  });

  it("single user message creates one turn with empty items and correct userText", () => {
    const result = aggregateTurns([makeUserMsg()]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].userText).toBe("hello");
    expect(result.turns[0].items).toEqual([]);
    expect(result.turns[0].userMessageId).toBe("u1");
    expect(result.turns[0].assistantMessageId).toBeNull();
  });

  it("user + assistant text creates one turn with assistantText item", () => {
    const result = aggregateTurns([makeUserMsg(), makeAssistantMsg()]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].items).toHaveLength(1);
    expect(result.turns[0].items[0].itemType).toBe("assistantText");
    if (result.turns[0].items[0].itemType === "assistantText") {
      expect(result.turns[0].items[0].text).toBe("response");
      expect(result.turns[0].items[0].messageId).toBe("a1");
      expect(result.turns[0].items[0].blockIndex).toBe(0);
    }
  });

  it("multi-turn conversation produces multiple turns with correct indices", () => {
    const result = aggregateTurns([
      makeUserMsg({ id: "u1" }),
      makeAssistantMsg({ id: "a1" }),
      makeUserMsg({ id: "u2" }),
      makeAssistantMsg({ id: "a2" }),
    ]);
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0].index).toBe(0);
    expect(result.turns[1].index).toBe(1);
    expect(result.turns[0].userMessageId).toBe("u1");
    expect(result.turns[1].userMessageId).toBe("u2");
  });

  it("assistant with thinking block produces assistantText item with thinking content", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg({}, [{ type: "thinking", thinking: "hmm..." }]),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].items).toHaveLength(1);
    if (result.turns[0].items[0].itemType === "assistantText") {
      expect(result.turns[0].items[0].text).toBe("hmm...");
    }
  });

  it("assistant with toolExecution block produces toolExecution item", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg({}, [
        {
          type: "toolExecution",
          toolCallId: "call1",
          toolName: "bash",
          args: "ls",
          status: "done",
        },
      ]),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].items).toHaveLength(1);
    if (result.turns[0].items[0].itemType === "toolExecution") {
      expect(result.turns[0].items[0].toolCallId).toBe("call1");
      expect(result.turns[0].items[0].toolName).toBe("bash");
    }
  });

  it("deduplicates repeated toolExecution items by toolCallId within a turn", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg(
        { id: "a1" },
        [
          {
            type: "toolExecution",
            toolCallId: "call1",
            toolName: "bash",
            args: "git reset --hard",
            status: "running",
            output: "waiting...",
          },
        ],
      ),
      makeAssistantMsg(
        { id: "a2" },
        [
          {
            type: "toolExecution",
            toolCallId: "call1",
            toolName: "bash",
            args: "git reset --hard",
            status: "done",
            output: "done",
          },
        ],
      ),
    ]);

    expect(result.turns).toHaveLength(1);
    const toolItems = result.turns[0].items.filter((item) => item.itemType === "toolExecution");
    expect(toolItems).toHaveLength(1);
    const item = toolItems[0];
    if (item.itemType === "toolExecution") {
      expect(item.messageId).toBe("a2");
      expect(item.status).toBe("done");
      expect(item.output).toBe("done");
    }
  });

  it("deduplicates repeated bash toolExecution items by command within a turn", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg(
        { id: "a1" },
        [
          {
            type: "toolExecution",
            toolCallId: "call-live",
            toolName: "bash",
            args: "cargo clippy --workspace",
            status: "running",
            output: "waiting...",
          },
        ],
      ),
      makeAssistantMsg(
        { id: "a2" },
        [
          {
            type: "toolExecution",
            toolCallId: "call-history",
            toolName: "bash",
            args: JSON.stringify({
              command: "cargo clippy --workspace",
              description: "M5.2 clippy",
            }),
            status: "done",
            output: "finished",
          },
        ],
      ),
    ]);

    expect(result.turns).toHaveLength(1);
    const toolItems = result.turns[0].items.filter((item) => item.itemType === "toolExecution");
    expect(toolItems).toHaveLength(1);
    const item = toolItems[0];
    if (item.itemType === "toolExecution") {
      expect(item.toolCallId).toBe("call-history");
      expect(item.status).toBe("done");
      expect(item.output).toBe("finished");
    }
  });

  it("does not deduplicate repeated toolCallIds across different turns", () => {
    const result = aggregateTurns([
      makeUserMsg({ id: "u1", content: [{ type: "text", text: "first" }] }),
      makeAssistantMsg(
        { id: "a1" },
        [
          {
            type: "toolExecution",
            toolCallId: "call1",
            toolName: "bash",
            args: "echo first",
            status: "done",
            output: "first",
          },
        ],
      ),
      makeUserMsg({ id: "u2", content: [{ type: "text", text: "second" }] }),
      makeAssistantMsg(
        { id: "a2" },
        [
          {
            type: "toolExecution",
            toolCallId: "call1",
            toolName: "bash",
            args: "echo second",
            status: "done",
            output: "second",
          },
        ],
      ),
    ]);

    expect(result.turns).toHaveLength(2);
    const firstTurnTools = result.turns[0].items.filter(
      (item) => item.itemType === "toolExecution",
    );
    const secondTurnTools = result.turns[1].items.filter(
      (item) => item.itemType === "toolExecution",
    );
    expect(firstTurnTools).toHaveLength(1);
    expect(secondTurnTools).toHaveLength(1);
    if (
      firstTurnTools[0].itemType === "toolExecution" &&
      secondTurnTools[0].itemType === "toolExecution"
    ) {
      expect(firstTurnTools[0].output).toBe("first");
      expect(secondTurnTools[0].output).toBe("second");
    }
  });

  it("assistant with custom block produces customEntry item", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg({}, [{ type: "custom", customType: "test", data: { k: "v" } }]),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].items).toHaveLength(1);
    if (result.turns[0].items[0].itemType === "customEntry") {
      expect(result.turns[0].items[0].customType).toBe("test");
    }
  });

  it("skips memory custom blocks in chat turns", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg({}, [
        { type: "custom", customType: "memory_prefetch_result", data: { summary: "injected" } },
        { type: "custom", customType: "memory_extract", data: { updated: 1 } },
        { type: "custom", customType: "memory_dream", data: { updates: 1 } },
      ]),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].items).toHaveLength(0);
  });

  it("skips standalone memory custom messages", () => {
    const result = aggregateTurns([
      {
        id: "mem1",
        role: "custom",
        content: [{ type: "custom", customType: "memory_prefetch", data: { query: "x" } }],
        timestamp: 3000,
      },
    ]);
    expect(result.turns).toHaveLength(0);
    expect(result.standalone).toHaveLength(0);
  });

  it("isStreaming propagates from user and assistant messages", () => {
    const result = aggregateTurns([
      makeUserMsg({ isStreaming: true }),
      makeAssistantMsg({ isStreaming: true }),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].isStreaming).toBe(true);
  });

  it("model/provider/tokenUsage propagate from assistant message to turn", () => {
    const usage = { input: 10, output: 20 };
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg({ model: "gpt-4", provider: "openai", tokenUsage: usage }),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].model).toBe("gpt-4");
    expect(result.turns[0].provider).toBe("openai");
    expect(result.turns[0].tokenUsage).toEqual(usage);
  });

  it("orphan assistant (no preceding user) creates turn_orphan_ turn", () => {
    const result = aggregateTurns([makeAssistantMsg({ id: "orphan1" })]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].id).toMatch(/^turn_orphan_/);
    expect(result.turns[0].userMessageId).toBeNull();
    expect(result.turns[0].assistantMessageId).toBe("orphan1");
  });

  it("custom message with no current turn goes to standalone", () => {
    const result = aggregateTurns([
      {
        id: "c1",
        role: "custom",
        content: [{ type: "custom", customType: "memory", data: { x: 1 } }],
        timestamp: 3000,
      },
    ]);
    expect(result.turns).toHaveLength(0);
    expect(result.standalone).toHaveLength(1);
    expect(result.standalone[0].id).toBe("c1");
  });

  it("custom message with current turn and assistantMessageId goes into turn items", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg({ id: "a1" }),
      {
        id: "c1",
        role: "custom",
        content: [{ type: "custom", customType: "activity", data: { v: 1 } }],
        timestamp: 3000,
      },
    ]);
    expect(result.turns).toHaveLength(1);
    const lastItem = result.turns[0].items[result.turns[0].items.length - 1];
    if (lastItem.itemType === "customEntry") {
      expect(lastItem.customType).toBe("activity");
    }
  });

  it("compactionSummary message finalizes current turn and goes to standalone", () => {
    const result = aggregateTurns([
      makeUserMsg(),
      makeAssistantMsg(),
      {
        id: "comp1",
        role: "compactionSummary",
        content: [{ type: "compactionSummary", summary: "compressed" }],
        timestamp: 4000,
      },
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.standalone).toHaveLength(1);
    expect(result.standalone[0].customType).toBe("compactionSummary");
  });

  it("toolResult message is ignored", () => {
    const result = aggregateTurns([
      {
        id: "tr1",
        role: "toolResult",
        content: [{ type: "toolResult", toolCallId: "c1", toolName: "bash", content: "output" }],
        timestamp: 3000,
      },
    ]);
    expect(result.turns).toHaveLength(0);
    expect(result.standalone).toHaveLength(0);
  });

  it("empty assistant followed by user: first user turn not finalized (items empty, no userMessageId guard in mid-loop)", () => {
    const result = aggregateTurns([
      makeUserMsg({ id: "u1" }),
      makeAssistantMsg({ id: "a1", content: [] }),
      makeUserMsg({ id: "u2" }),
      makeAssistantMsg({ id: "a2" }),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].userMessageId).toBe("u2");
    expect(result.turns[0].items).toHaveLength(1);
  });

  it("consecutive user messages: first user turn overwritten (items empty, only finalized at tail)", () => {
    const result = aggregateTurns([
      makeUserMsg({ id: "u1", content: [{ type: "text", text: "first" }] }),
      makeUserMsg({ id: "u2", content: [{ type: "text", text: "second" }] }),
      makeAssistantMsg({ id: "a1" }),
    ]);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0].userText).toBe("second");
    expect(result.turns[0].userMessageId).toBe("u2");
  });
});

describe("getItemId", () => {
  it("returns user_<messageId> for userMessage", () => {
    const item = {
      itemType: "userMessage" as const,
      messageId: "msg1",
      text: "hi",
      timestamp: 1000,
    };
    expect(getItemId(item)).toBe("user_msg1");
  });

  it("returns text_<messageId>_<blockIndex> for assistantText", () => {
    const item = {
      itemType: "assistantText" as const,
      blockIndex: 0,
      text: "hi",
      messageId: "msg1",
    };
    expect(getItemId(item)).toBe("text_msg1_0");
  });

  it("returns tool_<toolCallId> for toolExecution", () => {
    const item = {
      itemType: "toolExecution" as const,
      blockIndex: 0,
      toolCallId: "call123",
      toolName: "bash",
      args: "",
      status: "done" as const,
      messageId: "msg1",
    };
    expect(getItemId(item)).toBe("tool_call123");
  });

  it("returns custom_<entryId> for customEntry", () => {
    const item = {
      itemType: "customEntry" as const,
      entryId: "entry456",
      customType: "test",
      data: null,
      timestamp: 1000,
    };
    expect(getItemId(item)).toBe("custom_entry456");
  });
});
