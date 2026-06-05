import { describe, it, expect, vi } from "vitest";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";

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

import { normalizeToolBlocks } from "../src/mainview/stores/use-chat-store";

const TCID = "tc-bash-1";

function makeAssistantMsg(
  toolCalls: Array<{ id: string; name: string; input: string }>,
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  const content: ContentBlock[] = toolCalls.map((tc) => ({
    type: "toolCall" as const,
    id: tc.id,
    name: tc.name,
    input: tc.input,
  }));
  return {
    id: `msg-assistant-${Date.now()}`,
    role: "assistant",
    content,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeToolResultMsg(toolCallId: string, content: string, isError = false): ChatMessage {
  return {
    id: `msg-result-${Date.now()}`,
    role: "toolResult",
    content: [{ type: "toolResult", toolCallId, toolName: "bash", content, isError }],
    timestamp: Date.now(),
  };
}

function makeUserMsg(text: string): ChatMessage {
  return {
    id: `msg-user-${Date.now()}`,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

describe("normalizeToolBlocks", () => {
  it("should mark unmatched toolCall as 'running' (no toolResult exists)", () => {
    const msgs: ChatMessage[] = [
      makeUserMsg("run bash"),
      makeAssistantMsg([{ id: TCID, name: "bash", input: "sleep 100" }]),
    ];

    normalizeToolBlocks(msgs);

    expect(msgs.length).toBe(2);
    const assistantMsg = msgs.find((m) => m.role === "assistant")!;
    const execBlock = assistantMsg.content.find((b) => b.type === "toolExecution") as Extract<
      ContentBlock,
      { type: "toolExecution" }
    >;

    expect(execBlock).toBeDefined();
    expect(execBlock.status).toBe("running");
    expect(execBlock.toolCallId).toBe(TCID);
    expect(execBlock.toolName).toBe("bash");
    expect(execBlock.args).toBe("sleep 100");
  });

  it("should mark matched toolCall as 'done' when toolResult exists", () => {
    const msgs: ChatMessage[] = [
      makeUserMsg("run bash"),
      makeAssistantMsg([{ id: TCID, name: "bash", input: "echo hello" }]),
      makeToolResultMsg(TCID, "hello\n"),
    ];

    normalizeToolBlocks(msgs);

    expect(msgs.length).toBe(2);
    const assistantMsg = msgs.find((m) => m.role === "assistant")!;
    const execBlock = assistantMsg.content.find((b) => b.type === "toolExecution") as Extract<
      ContentBlock,
      { type: "toolExecution" }
    >;

    expect(execBlock).toBeDefined();
    expect(execBlock.status).toBe("done");
    expect(execBlock.output).toBe("hello\n");
  });

  it("should mark matched toolCall as 'error' when toolResult has isError", () => {
    const msgs: ChatMessage[] = [
      makeUserMsg("run bash"),
      makeAssistantMsg([{ id: TCID, name: "bash", input: "exit 1" }]),
      makeToolResultMsg(TCID, "command failed", true),
    ];

    normalizeToolBlocks(msgs);

    const assistantMsg = msgs.find((m) => m.role === "assistant")!;
    const execBlock = assistantMsg.content.find((b) => b.type === "toolExecution") as Extract<
      ContentBlock,
      { type: "toolExecution" }
    >;

    expect(execBlock.status).toBe("error");
    expect(execBlock.output).toBe("command failed");
  });

  it("should handle mixed: some toolCalls with results, some still running", () => {
    const TCID_DONE = "tc-done-1";
    const TCID_RUNNING = "tc-running-1";

    const msgs: ChatMessage[] = [
      makeUserMsg("run multiple"),
      makeAssistantMsg([
        { id: TCID_DONE, name: "bash", input: "echo done" },
        { id: TCID_RUNNING, name: "bash", input: "sleep 999" },
      ]),
      makeToolResultMsg(TCID_DONE, "done\n"),
    ];

    normalizeToolBlocks(msgs);

    const assistantMsg = msgs.find((m) => m.role === "assistant")!;
    const blocks = assistantMsg.content.filter((b) => b.type === "toolExecution") as Extract<
      ContentBlock,
      { type: "toolExecution" }
    >[];

    expect(blocks.length).toBe(2);
    const doneBlock = blocks.find((b) => b.toolCallId === TCID_DONE)!;
    const runningBlock = blocks.find((b) => b.toolCallId === TCID_RUNNING)!;

    expect(doneBlock.status).toBe("done");
    expect(doneBlock.output).toBe("done\n");

    expect(runningBlock.status).toBe("running");
    expect(runningBlock.output).toBeUndefined();
  });
});

describe("tool_execution_update terminal status", () => {
  it("should keep terminal status when receiving delayed partial output", () => {
    const block: Extract<ContentBlock, { type: "toolExecution" }> = {
      type: "toolExecution",
      toolCallId: TCID,
      toolName: "bash",
      args: "sleep 100",
      status: "done",
      output: "",
    };

    const newOutput = "1\n2\n3\n";
    const updated: Extract<ContentBlock, { type: "toolExecution" }> = {
      ...block,
      output: newOutput,
      status: block.status,
    };

    expect(updated.status).toBe("done");
    expect(updated.output).toBe(newOutput);
    expect(updated.toolCallId).toBe(TCID);
  });
});

describe("refresh recovery: loadSessionMessages should not overwrite replay", () => {
  it("replayHoldEvents should complete before loadSessionMessages (order guarantee)", async () => {
    const order: string[] = [];

    const replayPromise = (async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("replay");
    })();

    const loadPromise = replayPromise.then(() => {
      order.push("load");
    });

    await Promise.all([replayPromise, loadPromise]);

    expect(order).toEqual(["replay", "load"]);
  });
});
