import { describe, it, expect, vi } from "vitest";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";
import { formatTokenCount } from "../src/mainview/utils/turn-utils";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));
vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));
vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({
      activeSessionId: "s1",
      sessionReady: {},
      restoreContextFromHistory: vi.fn(),
    }),
  },
}));
vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: { getState: () => ({ addEvent: vi.fn(), addInjected: vi.fn() }) },
}));
vi.mock("../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: { getState: () => ({ activeSubsessionId: null }) },
}));
vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result"]),
}));
vi.mock("../src/shared/modules/agent", () => ({}));

import { normalizeToolBlocks } from "../src/mainview/stores/use-chat-store";

function makeAssistant(id: string, blocks: ContentBlock[]): ChatMessage {
  return { id, role: "assistant", content: blocks, timestamp: Date.now() };
}

function makeUser(id: string, text: string): ChatMessage {
  return { id, role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function makeToolResult(
  id: string,
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
): ChatMessage {
  const block: ContentBlock = {
    type: "toolResult",
    toolCallId,
    toolName,
    content,
    isError,
  };
  return { id, role: "toolResult", content: [block], timestamp: Date.now() };
}

function toolCall(id: string, name: string, input: string): ContentBlock {
  return { type: "toolCall", id, name, input };
}

function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

// ─── normalizeToolBlocks: working cases ───

describe("normalizeToolBlocks — correct behavior", () => {
  it("merges matched toolCall + toolResult into toolExecution", () => {
    const msgs: ChatMessage[] = [
      makeUser("u1", "hello"),
      makeAssistant("a1", [
        textBlock("thinking..."),
        toolCall("tc1", "readFile", '{"path":"foo.ts"}'),
      ]),
      makeToolResult("tr1", "tc1", "readFile", "file contents here"),
    ];

    normalizeToolBlocks(msgs);

    expect(msgs.length).toBe(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");

    const assistant = msgs[1];
    expect(assistant.content.length).toBe(2);
    expect(assistant.content[0].type).toBe("text");
    expect(assistant.content[1].type).toBe("toolExecution");

    const exec = assistant.content[1] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec.toolName).toBe("readFile");
    expect(exec.status).toBe("done");
    expect(exec.output).toBe("file contents here");
    expect(exec.args).toBe('{"path":"foo.ts"}');
  });

  it("converts unmatched toolCall to running toolExecution", () => {
    const msgs: ChatMessage[] = [
      makeAssistant("a1", [
        textBlock("let me read..."),
        toolCall("tc1", "readFile", '{"path":"a.ts"}'),
      ]),
    ];

    normalizeToolBlocks(msgs);

    expect(msgs[0].content.length).toBe(2);
    const exec = msgs[0].content[1] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec.type).toBe("toolExecution");
    expect(exec.status).toBe("running");
    expect(exec.toolName).toBe("readFile");
  });

  it("handles multiple toolCalls in one assistant message", () => {
    const msgs: ChatMessage[] = [
      makeAssistant("a1", [
        textBlock("reading files..."),
        toolCall("tc1", "readFile", '{"path":"a.ts"}'),
        toolCall("tc2", "readFile", '{"path":"b.ts"}'),
      ]),
      makeToolResult("tr1", "tc1", "readFile", "content-a"),
      makeToolResult("tr2", "tc2", "readFile", "content-b"),
    ];

    normalizeToolBlocks(msgs);

    expect(msgs.length).toBe(1);
    expect(msgs[0].content.length).toBe(3);
    expect(msgs[0].content[1].type).toBe("toolExecution");
    expect(msgs[0].content[2].type).toBe("toolExecution");

    const exec1 = msgs[0].content[1] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec1.output).toBe("content-a");

    const exec2 = msgs[0].content[2] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec2.output).toBe("content-b");
  });

  it("handles toolResult with isError=true", () => {
    const msgs: ChatMessage[] = [
      makeAssistant("a1", [toolCall("tc1", "bash", '{"cmd":"fail"}')]),
      makeToolResult("tr1", "tc1", "bash", "command failed", true),
    ];

    normalizeToolBlocks(msgs);

    const exec = msgs[0].content[0] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec.status).toBe("error");
  });

  it("preserves non-toolCall blocks in assistant messages", () => {
    const msgs: ChatMessage[] = [
      makeAssistant("a1", [
        textBlock("before"),
        toolCall("tc1", "readFile", "{}"),
        textBlock("after"),
      ]),
      makeToolResult("tr1", "tc1", "readFile", "result"),
    ];

    normalizeToolBlocks(msgs);
    expect(msgs[0].content.map((b) => b.type)).toEqual(["text", "toolExecution", "text"]);
  });
});

// ─── normalizeToolBlocks: BUG FIXES ───

describe("normalizeToolBlocks — bug fixes", () => {
  it("BUG FIX: orphan toolResult with no preceding assistant should be preserved as toolExecution in a synthetic assistant", () => {
    const msgs: ChatMessage[] = [makeToolResult("tr1", "tc-missing", "readFile", "orphan result")];

    normalizeToolBlocks(msgs);

    // FIX: orphan toolResult should NOT be silently deleted.
    // It should be preserved — either as a standalone message or converted.
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const remaining = msgs[0];
    // The content should contain the toolResult data, not be empty
    const hasToolExec = remaining.content.some(
      (b) =>
        b.type === "toolExecution" &&
        (b as Extract<ContentBlock, { type: "toolExecution" }>).toolCallId === "tc-missing",
    );
    expect(hasToolExec).toBe(true);
  });

  it("BUG FIX: orphan toolResult after assistant with NO toolCalls should append toolExecution", () => {
    const msgs: ChatMessage[] = [
      makeAssistant("a1", [textBlock("just text")]),
      makeToolResult("tr1", "tc-missing", "readFile", "orphan result"),
    ];

    normalizeToolBlocks(msgs);

    // FIX: the toolResult should be appended to a1 as a toolExecution block
    expect(msgs.length).toBe(1);
    expect(msgs[0].id).toBe("a1");
    expect(msgs[0].content.length).toBe(2);
    expect(msgs[0].content[0].type).toBe("text");

    const exec = msgs[0].content[1] as Extract<ContentBlock, { type: "toolExecution" }>;
    expect(exec.type).toBe("toolExecution");
    expect(exec.toolName).toBe("readFile");
    expect(exec.output).toBe("orphan result");
  });
});

// ─── formatTokenCount: BUG FIX ───

describe("formatTokenCount — bug fixes", () => {
  it("BUG FIX: 999999 should not produce '1000.0K'", () => {
    // 999999/1000 = 999.999, toFixed(1) rounds up to "1000.0"
    // FIX: should display as "1.0M" instead of "1000.0K"
    expect(formatTokenCount(999999)).toBe("1.0M");
  });

  it("BUG FIX: 999950 should not produce '1000.0K'", () => {
    // 999950/1000 = 999.95, toFixed(1) rounds to "1000.0"
    // FIX: should display as "1.0M"
    expect(formatTokenCount(999950)).toBe("1.0M");
  });
});

describe("formatTokenCount — correct behavior", () => {
  it("formats 0", () => {
    expect(formatTokenCount(0)).toBe("0");
  });

  it("formats small numbers as-is", () => {
    expect(formatTokenCount(42)).toBe("42");
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats exact thousands without decimal", () => {
    expect(formatTokenCount(1000)).toBe("1K");
    expect(formatTokenCount(2000)).toBe("2K");
  });

  it("formats thousands with remainder", () => {
    expect(formatTokenCount(1500)).toBe("1.5K");
    expect(formatTokenCount(1234)).toBe("1.2K");
  });

  it("formats millions", () => {
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
    expect(formatTokenCount(2_500_000)).toBe("2.5M");
  });

  it("formats 999499 correctly", () => {
    expect(formatTokenCount(999499)).toBe("999.5K");
  });
});
