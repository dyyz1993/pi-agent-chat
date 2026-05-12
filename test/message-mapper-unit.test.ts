import { describe, it, expect } from "vitest";
import {
  messageToChatMessage,
  parseToolResultBlock,
  extractTokenUsage,
  extractContent,
  extractToolCallNameMap,
  getTextContent,
} from "../src/mainview/lib/message-mapper";
import type { ChatMessage } from "../src/mainview/types";
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  Usage,
} from "@dyyz1993/pi-ai";

describe("messageToChatMessage", () => {
  it("returns null for null input", () => {
    expect(messageToChatMessage(null as unknown as Message)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(messageToChatMessage(undefined as unknown as Message)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(messageToChatMessage("hello" as unknown as Message)).toBeNull();
    expect(messageToChatMessage(42 as unknown as Message)).toBeNull();
  });

  it("returns null for object without role", () => {
    expect(messageToChatMessage({ foo: "bar" } as unknown as Message)).toBeNull();
  });

  it("converts user message with string content", () => {
    const msg: UserMessage = {
      role: "user",
      content: "hello world",
      timestamp: 1000,
    };
    const result = messageToChatMessage(msg, "user-1");
    expect(result).toEqual({
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "hello world" }],
      timestamp: 1000,
    });
  });

  it("converts user message with array content", () => {
    const msg: UserMessage = {
      role: "user",
      content: [
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ],
      timestamp: 2000,
    };
    const result = messageToChatMessage(msg, "user-2");
    expect(result).toEqual({
      id: "user-2",
      role: "user",
      content: [
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ],
      timestamp: 2000,
    });
  });

  it("returns null for user message with empty string content", () => {
    const msg: UserMessage = {
      role: "user",
      content: "",
      timestamp: 3000,
    };
    expect(messageToChatMessage(msg, "user-3")).toBeNull();
  });

  it("converts assistant plain text message with model/provider/stopReason", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      timestamp: 4000,
      model: "gpt-4",
      provider: "openai",
      stopReason: "endTurn",
    };
    const result = messageToChatMessage(msg, "asst-1");
    expect(result).toEqual({
      id: "asst-1",
      role: "assistant",
      content: [{ type: "text", text: "hi there" }],
      timestamp: 4000,
      model: "gpt-4",
      provider: "openai",
      stopReason: "endTurn",
    });
  });

  it("converts assistant with thinking block", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "let me think..." }],
      timestamp: 5000,
    };
    const result = messageToChatMessage(msg, "asst-2");
    expect(result).toEqual({
      id: "asst-2",
      role: "assistant",
      content: [{ type: "thinking", thinking: "let me think..." }],
      timestamp: 5000,
    });
  });

  it("converts assistant with toolCall block", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tc-1",
          name: "read_file",
          arguments: { path: "/foo.ts" },
        },
      ],
      timestamp: 6000,
    };
    const result = messageToChatMessage(msg, "asst-3");
    expect(result).toEqual({
      id: "asst-3",
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "tc-1",
          name: "read_file",
          input: JSON.stringify({ path: "/foo.ts" }, null, 2),
        },
      ],
      timestamp: 6000,
    });
  });

  it("returns null for assistant with empty content", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [],
      timestamp: 7000,
    };
    expect(messageToChatMessage(msg, "asst-4")).toBeNull();
  });

  it("extracts tokenUsage from assistant with usage", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "response" }],
      timestamp: 8000,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 10,
        cacheWrite: 20,
        cost: { total: 0.005 },
      },
    };
    const result = messageToChatMessage(msg, "asst-5");
    expect(result?.tokenUsage).toEqual({
      input: 100,
      output: 50,
      cacheRead: 10,
      cacheWrite: 20,
      cost: 0.005,
    });
  });

  it("omits tokenUsage when assistant has no usage", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "response" }],
      timestamp: 9000,
    };
    const result = messageToChatMessage(msg, "asst-6");
    expect(result?.tokenUsage).toBeUndefined();
  });

  it("converts toolResult message", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-1",
      toolName: "read_file",
      content: [{ type: "text", text: "file contents here" }],
      timestamp: 10000,
    };
    const result = messageToChatMessage(msg, "tr-1");
    expect(result).toEqual({
      id: "tr-1",
      role: "toolResult",
      content: [
        {
          type: "toolResult",
          toolCallId: "tc-1",
          toolName: "read_file",
          content: "file contents here",
          isError: undefined,
          args: undefined,
          details: undefined,
        },
      ],
      timestamp: 10000,
    });
  });

  it("prefers toolCallNameMap over message.toolName for toolResult", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-2",
      toolName: "old_name",
      content: [{ type: "text", text: "result" }],
      timestamp: 11000,
    };
    const map = { "tc-2": "new_name" };
    const result = messageToChatMessage(msg, "tr-2", map);
    expect(result?.content[0]).toMatchObject({
      type: "toolResult",
      toolName: "new_name",
    });
  });

  it("propagates isError for toolResult", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-3",
      content: [{ type: "text", text: "error occurred" }],
      isError: true,
      timestamp: 12000,
    };
    const result = messageToChatMessage(msg, "tr-3");
    expect(result?.content[0]).toMatchObject({
      type: "toolResult",
      isError: true,
    });
  });

  it("converts custom message", () => {
    const msg = {
      role: "custom",
      customType: "info",
      data: { key: "value" },
      timestamp: 13000,
    } as unknown as Message;
    const result = messageToChatMessage(msg, "custom-1");
    expect(result).toEqual({
      id: "custom-1",
      role: "custom",
      content: [{ type: "custom", customType: "info", data: { key: "value" } }],
      timestamp: 13000,
    });
  });

  it("prefers details over data in custom message", () => {
    const msg = {
      role: "custom",
      customType: "status",
      data: { old: true },
      details: { new: true },
      timestamp: 14000,
    } as unknown as Message;
    const result = messageToChatMessage(msg, "custom-2");
    expect(result?.content[0]).toMatchObject({
      type: "custom",
      data: { new: true },
    });
  });

  it("converts compactionSummary message", () => {
    const msg = {
      role: "compactionSummary",
      summary: "compacted content",
      tokensBefore: 5000,
      timestamp: 15000,
    } as unknown as Message;
    const result = messageToChatMessage(msg, "cs-1");
    expect(result).toEqual({
      id: "cs-1",
      role: "compactionSummary",
      content: [{ type: "compactionSummary", summary: "compacted content", tokensBefore: 5000 }],
      timestamp: 15000,
    });
  });

  it("returns null for compactionSummary with empty summary", () => {
    const msg = {
      role: "compactionSummary",
      summary: "",
      timestamp: 16000,
    } as unknown as Message;
    expect(messageToChatMessage(msg, "cs-2")).toBeNull();
  });

  it("returns null for unknown role", () => {
    const msg = { role: "system", content: "be helpful", timestamp: 17000 } as unknown as Message;
    expect(messageToChatMessage(msg, "sys-1")).toBeNull();
  });

  it("generates id when not provided", () => {
    const msg: UserMessage = {
      role: "user",
      content: "hi",
      timestamp: 18000,
    };
    const result = messageToChatMessage(msg);
    expect(result?.id).toBeTruthy();
    expect(typeof result?.id).toBe("string");
  });
});

describe("extractToolCallNameMap", () => {
  it("fills map with toolCallId to toolName", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "tc-a", name: "tool_a", arguments: {} },
        { type: "toolCall", id: "tc-b", name: "tool_b", arguments: { x: 1 } },
        { type: "text", text: "some text" },
      ],
      timestamp: 1000,
    };
    const map: Record<string, string> = {};
    extractToolCallNameMap(msg, map);
    expect(map).toEqual({ "tc-a": "tool_a", "tc-b": "tool_b" });
  });

  it("does not overwrite existing entries", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tc-a", name: "new_name", arguments: {} }],
      timestamp: 1000,
    };
    const map: Record<string, string> = { "tc-a": "old_name" };
    extractToolCallNameMap(msg, map);
    expect(map["tc-a"]).toBe("new_name");
  });
});

describe("getTextContent", () => {
  it("extracts and concatenates all text blocks", () => {
    const msg: ChatMessage = {
      id: "1",
      role: "user",
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
      timestamp: 1000,
    };
    expect(getTextContent(msg)).toBe("hello world");
  });

  it("only extracts text blocks, ignoring non-text blocks", () => {
    const msg: ChatMessage = {
      id: "2",
      role: "assistant",
      content: [
        { type: "text", text: "visible" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: " text" },
      ],
      timestamp: 2000,
    };
    expect(getTextContent(msg)).toBe("visible text");
  });
});

describe("extractTokenUsage", () => {
  it("returns undefined for undefined usage", () => {
    expect(extractTokenUsage(undefined)).toBeUndefined();
  });

  it("returns undefined when all fields are falsy", () => {
    expect(extractTokenUsage({} as Usage)).toBeUndefined();
  });

  it("extracts all fields correctly", () => {
    const usage: Usage = {
      input: 10,
      output: 20,
      cacheRead: 5,
      cacheWrite: 3,
      cost: { total: 0.01 },
    };
    expect(extractTokenUsage(usage)).toEqual({
      input: 10,
      output: 20,
      cacheRead: 5,
      cacheWrite: 3,
      cost: 0.01,
    });
  });
});

describe("extractContent", () => {
  it("extracts content from user message with string content", () => {
    const msg: UserMessage = {
      role: "user",
      content: "hello",
      timestamp: 1000,
    };
    expect(extractContent(msg)).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns empty array for empty string content", () => {
    const msg: UserMessage = {
      role: "user",
      content: "",
      timestamp: 1000,
    };
    expect(extractContent(msg)).toEqual([]);
  });

  it("extracts mixed content blocks from assistant", () => {
    const msg: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "text" },
        { type: "thinking", thinking: "thought" },
        { type: "toolCall", id: "tc-1", name: "fn", arguments: { a: 1 } },
      ],
      timestamp: 1000,
    };
    expect(extractContent(msg)).toEqual([
      { type: "text", text: "text" },
      { type: "thinking", thinking: "thought" },
      { type: "toolCall", id: "tc-1", name: "fn", input: '{\n  "a": 1\n}' },
    ]);
  });
});

describe("parseToolResultBlock", () => {
  it("parses tool result with toolCallNameMap", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-x",
      content: [{ type: "text", text: "done" }],
      timestamp: 1000,
    };
    const map = { "tc-x": "mapped_tool" };
    const block = parseToolResultBlock(msg, map);
    expect(block).toEqual({
      type: "toolResult",
      toolCallId: "tc-x",
      toolName: "mapped_tool",
      content: "done",
      isError: undefined,
      args: undefined,
      details: undefined,
    });
  });

  it("falls back to message.toolName when not in map", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-y",
      toolName: "fallback_name",
      content: [{ type: "text", text: "ok" }],
      timestamp: 1000,
    };
    const block = parseToolResultBlock(msg, {});
    expect(block?.toolName).toBe("fallback_name");
  });

  it("concatenates multiple text content parts", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-z",
      content: [
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ],
      timestamp: 1000,
    };
    const block = parseToolResultBlock(msg, {});
    expect(block?.content).toBe("part1part2");
  });

  it("handles non-text content parts gracefully", () => {
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-w",
      content: [
        { type: "text", text: "good" },
        { type: "image" as "text", text: "ignored" } as unknown as { type: "text"; text: string },
      ],
      timestamp: 1000,
    };
    const block = parseToolResultBlock(msg, {});
    expect(block?.content).toBe("good");
  });

  it("preserves details field", () => {
    const details = { exitCode: 0, stdout: "ok" };
    const msg: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "tc-d",
      content: [{ type: "text", text: "result" }],
      details,
      timestamp: 1000,
    };
    const block = parseToolResultBlock(msg, {});
    expect(block?.details).toEqual(details);
  });
});
