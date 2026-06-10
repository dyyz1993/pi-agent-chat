import { describe, expect, it, vi } from "vitest";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";
import {
  closeRunningToolExecutions,
  findMatchingPendingToolExecution,
  findMatchingToolExecution,
  formatToolArgs,
  isDelayedTerminalMessageUpdate,
  isTerminalToolStatus,
  normalizeToolArgsForMatch,
} from "../../../src/mainview/stores/agent-event-reconciler";

function toolExecution(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "tc-1",
    toolName: "bash",
    args: "ls now-mock",
    status: "running",
    ...overrides,
  };
}

function assistantMessage(content: ContentBlock[], isStreaming = false): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content,
    timestamp: 1,
    isStreaming,
  };
}

describe("agent event reconciler", () => {
  it("formats object tool args using command as the display arg", () => {
    expect(
      formatToolArgs({
        command: "ls now-mock",
        timeout: 15,
        description: "查看 now-mock 项目",
      }),
    ).toEqual({
      args: "ls now-mock",
      timeout: 15,
      description: "查看 now-mock 项目",
    });
  });

  it("normalizes JSON command args and plain command args to the same key", () => {
    expect(normalizeToolArgsForMatch(JSON.stringify({ command: "ls now-mock" }, null, 2))).toBe(
      "ls now-mock",
    );
    expect(normalizeToolArgsForMatch("ls now-mock")).toBe("ls now-mock");
  });

  it("finds a pending message-update tool block by tool name and normalized args", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "Checking..." },
      toolExecution({
        toolCallId: "message-tool-id",
        args: JSON.stringify({ command: "ls now-mock" }, null, 2),
      }),
    ];

    expect(findMatchingPendingToolExecution(blocks, "bash", "ls now-mock")).toBe(1);
  });

  it("does not match terminal tool blocks for id reconciliation", () => {
    const blocks: ContentBlock[] = [
      toolExecution({
        toolCallId: "message-tool-id",
        status: "done",
      }),
    ];

    expect(findMatchingPendingToolExecution(blocks, "bash", "ls now-mock")).toBe(-1);
  });

  it("can match terminal tool blocks when reconciling replayed starts", () => {
    const blocks: ContentBlock[] = [
      toolExecution({
        toolCallId: "history-tool-id",
        args: JSON.stringify({ command: "ls now-mock" }, null, 2),
        status: "done",
      }),
    ];

    expect(findMatchingToolExecution(blocks, "bash", "ls now-mock", { includeTerminal: true })).toBe(
      0,
    );
  });

  it("closes only running tool executions", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const content: ContentBlock[] = [
      toolExecution({ toolCallId: "running", status: "running" }),
      toolExecution({ toolCallId: "done", status: "done", endedAt: 10 }),
    ];

    const closed = closeRunningToolExecutions(content, "done");

    expect((closed[0] as Extract<ContentBlock, { type: "toolExecution" }>).status).toBe("done");
    expect((closed[0] as Extract<ContentBlock, { type: "toolExecution" }>).endedAt).toBe(1234);
    expect((closed[1] as Extract<ContentBlock, { type: "toolExecution" }>).endedAt).toBe(10);
    nowSpy.mockRestore();
  });

  it("detects delayed message_update for an already terminal tool call", () => {
    const messages = [
      assistantMessage([
        toolExecution({
          toolCallId: "tc-terminal",
          status: "done",
        }),
      ]),
    ];
    const incomingContent = [{ type: "toolCall", id: "tc-terminal", name: "bash" }];

    expect(isDelayedTerminalMessageUpdate(messages, incomingContent)).toBe(true);
  });

  it("treats terminal tool updates as delayed even while a placeholder is streaming", () => {
    const messages = [
      assistantMessage([
        toolExecution({
          toolCallId: "tc-terminal",
          status: "done",
        }),
      ]),
      assistantMessage([], true),
    ];
    const incomingContent = [{ type: "toolCall", id: "tc-terminal", name: "bash" }];

    expect(isDelayedTerminalMessageUpdate(messages, incomingContent)).toBe(true);
  });

  it("does not treat updates for still-running tool calls as delayed terminal updates", () => {
    const messages = [
      assistantMessage(
        [
          toolExecution({
            toolCallId: "tc-running",
            status: "running",
          }),
        ],
        true,
      ),
    ];
    const incomingContent = [{ type: "toolCall", id: "tc-running", name: "bash" }];

    expect(isDelayedTerminalMessageUpdate(messages, incomingContent)).toBe(false);
  });

  it("recognizes terminal tool statuses", () => {
    expect(isTerminalToolStatus("done")).toBe(true);
    expect(isTerminalToolStatus("error")).toBe(true);
    expect(isTerminalToolStatus("running")).toBe(false);
  });
});
