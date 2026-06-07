import { beforeEach, describe, expect, it } from "vitest";
import type { BashChannelEvent, BashProcess } from "../src/shared/modules/bash";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";
import { reconcileChatToolFromBashEvent } from "../src/mainview/stores/session-subscriptions";
import { useChatStore } from "../src/mainview/stores/use-chat-store";

const SID = "bash-output-stream-session";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

function bashBlock(
  overrides: Partial<ToolExecBlock> = {},
): ToolExecBlock {
  return {
    type: "toolExecution",
    toolCallId: "test-123",
    toolName: "bash",
    args: "echo test",
    status: "running",
    output: "",
    ...overrides,
  };
}

function assistant(id: string, content: ContentBlock[]): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: 1,
    isStreaming: true,
  };
}

function runningProcess(overrides: Partial<BashProcess> = {}): BashProcess {
  return {
    toolCallId: "test-123",
    command: "echo test",
    cwd: "/tmp/project",
    startedAt: 1000,
    output: "",
    status: "running",
    ...overrides,
  };
}

function doneProcess(overrides: Partial<BashProcess> = {}): BashProcess {
  return {
    toolCallId: "test-123",
    command: "echo test",
    cwd: "/tmp/project",
    startedAt: 1000,
    endedAt: 2000,
    output: "test\n",
    status: "done",
    exitCode: 0,
    ...overrides,
  };
}

function outputEvent(proc: BashProcess): BashChannelEvent {
  return {
    type: "output",
    toolCallId: proc.toolCallId,
    processes: [proc],
    timestamp: Date.now(),
  };
}

function endEvent(proc: BashProcess): BashChannelEvent {
  return {
    type: "end",
    toolCallId: proc.toolCallId,
    processes: [proc],
    timestamp: proc.endedAt ?? Date.now(),
  };
}

function toolBlocks(): ToolExecBlock[] {
  return (useChatStore.getState().messagesBySession[SID] ?? []).flatMap((msg) =>
    msg.content.filter(
      (block): block is ToolExecBlock => block.type === "toolExecution",
    ),
  );
}

beforeEach(() => {
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
});

describe("reconcileChatToolFromBashEvent — output streaming", () => {
  it("updates the block output field when an output event arrives", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock()]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({
          output: "count: 1\n",
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toBe("count: 1\n");
    expect(blocks[0].status).toBe("running");
  });

  it("accumulates output across multiple output events", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock()]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(runningProcess({ output: "count: 1\n", startedAt: 1000 })),
    );

    // Second output chunk — the process output field has the FULL accumulated text
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({ output: "count: 1\ncount: 2\n", startedAt: 1000 }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks[0].status).toBe("running");
    expect(blocks[0].output).toBe("count: 1\ncount: 2\n");
  });

  it("changes the block status to done and sets output when an end event arrives", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock()]),
    ]);

    reconcileChatToolFromBashEvent(SID, endEvent(doneProcess({ output: "test\n" })));

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("test\n");
  });

  it("streaming output events update block, then end event sets final output", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock()]),
    ]);

    // First output chunk
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(runningProcess({ output: "count: 1\n", startedAt: 1000 })),
    );
    let blocks = toolBlocks();
    expect(blocks[0].status).toBe("running");
    expect(blocks[0].output).toBe("count: 1\n");

    // Second output chunk
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({ output: "count: 1\ncount: 2\n", startedAt: 1000 }),
      ),
    );
    blocks = toolBlocks();
    expect(blocks[0].output).toBe("count: 1\ncount: 2\n");

    // End event applies the final output
    reconcileChatToolFromBashEvent(
      SID,
      endEvent(
        doneProcess({
          output: "count: 1\ncount: 2\ndone\n",
          startedAt: 1000,
          endedAt: 3000,
        }),
      ),
    );

    blocks = toolBlocks();
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("count: 1\ncount: 2\ndone\n");
    expect(blocks[0].endedAt).toBe(3000);
  });

  it("does not change endedAt during output events (preserves original)", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock({ endedAt: undefined })]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(runningProcess({ output: "partial\n" })),
    );

    const blocks = toolBlocks();
    expect(blocks[0].status).toBe("running");
    expect(blocks[0].endedAt).toBeUndefined();
  });
});

describe("reconcileChatToolFromBashEvent — parallel bash matching", () => {
  it("matches the correct block by exact toolCallId when multiple running bash blocks exist", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [
        bashBlock({ toolCallId: "call-A", args: "for i in $(seq 1 5); do echo count: $i; done" }),
        bashBlock({ toolCallId: "call-B", args: "for i in $(seq 1 5); do echo count: $i; done" }),
      ]),
    ]);

    // Output event for call-B
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({
          toolCallId: "call-B",
          command: "for i in $(seq 1 5); do echo count: $i; done",
          output: "count: 1\n",
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(2);
    // call-A should be untouched
    expect(blocks[0].toolCallId).toBe("call-A");
    expect(blocks[0].output).toBe("");
    // call-B should have the output
    expect(blocks[1].toolCallId).toBe("call-B");
    expect(blocks[1].output).toBe("count: 1\n");
  });

  it("updates the correct block independently for each parallel bash process", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [
        bashBlock({ toolCallId: "call-A", args: "echo AAA" }),
        bashBlock({ toolCallId: "call-B", args: "echo BBB" }),
      ]),
    ]);

    // Output for call-A
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({ toolCallId: "call-A", command: "echo AAA", output: "AAA\n" }),
      ),
    );

    // Output for call-B
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({ toolCallId: "call-B", command: "echo BBB", output: "BBB\n" }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(2);
    expect(blocks[0].toolCallId).toBe("call-A");
    expect(blocks[0].output).toBe("AAA\n");
    expect(blocks[1].toolCallId).toBe("call-B");
    expect(blocks[1].output).toBe("BBB\n");
  });

  it("falls back to semantic match when toolCallId differs (bash channel vs LLM)", () => {
    // The bash channel's toolCallId may differ from the LLM's tool_use.id
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [
        bashBlock({ toolCallId: "llm-id-1", args: "echo unique-cmd-xyz" }),
      ]),
    ]);

    // Bash channel uses a different toolCallId
    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({
          toolCallId: "bash-channel-id-1",
          command: "echo unique-cmd-xyz",
          output: "unique-cmd-xyz\n",
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toBe("unique-cmd-xyz\n");
    expect(blocks[0].status).toBe("running");
  });
});
