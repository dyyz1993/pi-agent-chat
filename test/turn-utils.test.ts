import { describe, it, expect } from "vitest";
import { groupMessagesIntoTurns, formatTokenCount } from "../src/mainview/utils/turn-utils";
import type { ChatMessage } from "../src/mainview/types";

function makeUser(id: string, timestamp = 1000): ChatMessage {
  return { id, role: "user", content: [{ type: "text", text: "hi" }], timestamp };
}

function makeAssistant(
  id: string,
  opts?: { tokenUsage?: { input: number; output: number } },
  timestamp = 2000,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text: "response" }],
    timestamp,
    tokenUsage: opts?.tokenUsage,
  };
}

describe("groupMessagesIntoTurns", () => {
  it("returns empty turns for empty messages", () => {
    expect(groupMessagesIntoTurns([])).toEqual([]);
  });

  it("creates 1 turn for single user message", () => {
    const turns = groupMessagesIntoTurns([makeUser("u1")]);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessageId).toBe("u1");
    expect(turns[0].assistantMessageIds).toEqual([]);
  });

  it("creates 1 turn for single assistant message with null userMessageId", () => {
    const turns = groupMessagesIntoTurns([makeAssistant("a1")]);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessageId).toBeNull();
    expect(turns[0].assistantMessageIds).toEqual(["a1"]);
  });

  it("groups user + assistant into 1 turn", () => {
    const turns = groupMessagesIntoTurns([makeUser("u1"), makeAssistant("a1")]);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessageId).toBe("u1");
    expect(turns[0].assistantMessageIds).toEqual(["a1"]);
  });

  it("splits user + assistant + user into 2 turns", () => {
    const turns = groupMessagesIntoTurns([makeUser("u1"), makeAssistant("a1"), makeUser("u2")]);
    expect(turns).toHaveLength(2);
    expect(turns[0].userMessageId).toBe("u1");
    expect(turns[1].userMessageId).toBe("u2");
  });

  it("groups multiple assistants after 1 user into 1 turn", () => {
    const turns = groupMessagesIntoTurns([
      makeUser("u1"),
      makeAssistant("a1"),
      makeAssistant("a2"),
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].assistantMessageIds).toEqual(["a1", "a2"]);
  });

  it("captures token usage from last assistant message", () => {
    const usage = { input: 100, output: 200 };
    const turns = groupMessagesIntoTurns([
      makeUser("u1"),
      makeAssistant("a1", { tokenUsage: usage }),
    ]);
    expect(turns[0].tokenUsage).toEqual(usage);
  });
});

describe("formatTokenCount", () => {
  it("returns raw number for small values", () => {
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(123)).toBe("123");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(1500)).toBe("1.5K");
    expect(formatTokenCount(9999)).toBe("10.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
    expect(formatTokenCount(2_500_000)).toBe("2.5M");
  });
});
