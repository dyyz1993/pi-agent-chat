import { beforeEach, describe, expect, it } from "vitest";
import type { BashChannelEvent, BashProcess } from "../../../src/shared/modules/bash";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";
import {
  reconcileChatToolFromBashEvent,
  syncBashStoreToChat,
} from "../../../src/mainview/stores/session-subscriptions";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useBashStore } from "../../../src/mainview/stores/use-bash-store";

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

function backgroundEvent(proc: BashProcess): BashChannelEvent {
  return {
    type: "background",
    toolCallId: proc.toolCallId,
    processes: [proc],
    timestamp: Date.now(),
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
  useBashStore.setState({
    processesBySession: {},
    subscribedOutputs: new Set<string>(),
    backgroundedIds: new Set<string>(),
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

  it("marks the chat block as background when a bash background event arrives", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock({ startedAt: 1000, output: "tick-1\n" })]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      backgroundEvent(
        runningProcess({
          status: "background",
          output: "tick-1\ntick-2\n",
          startedAt: 1000,
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("background");
    expect(blocks[0].output).toBe("tick-1\ntick-2\n");
    expect(blocks[0].endedAt).toBeUndefined();
    expect(blocks[0].details).toMatchObject({
      background: {
        command: "echo test",
        startedAt: 1000,
        output: "tick-1\ntick-2\n",
      },
    });
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

describe("reconcileChatToolFromBashEvent — post-refresh reconciliation", () => {
  // After a page refresh, loadSessionMessages reads JSONL and runs
  // normalizeToolBlocks, which produces toolExecution blocks with args
  // formatted as JSON strings (e.g. '{"command":"...","description":"..."}').
  // Bash events continue streaming in with bash-channel toolCallIds that
  // differ from the LLM's tool_use.id. We must update the chat block output
  // via the semantic-command fallback.

  it("reconciles a post-refresh block with JSON args via command match", () => {
    const fullCmd = "{ for i in $(seq 1 20); do echo \"A-$i\"; sleep 1; done } & { for i in $(seq 1 20); do echo \"B-$i\"; sleep 1; done } & wait";
    const jsonArgs = JSON.stringify({ command: fullCmd, description: "Run A and B in parallel with wait", timeout: 25 });
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-refresh", [
        bashBlock({
          toolCallId: "llm-tool-call-xyz",
          args: jsonArgs,
          status: "running",
          output: "",
          startedAt: 1000,
        }),
      ]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({
          toolCallId: "bash-channel-abc",
          command: fullCmd,
          output: "B-1\nA-1\nA-2\nB-2\n",
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toBe("B-1\nA-1\nA-2\nB-2\n");
    expect(blocks[0].status).toBe("running");
  });

  it("accumulates output across multiple bash events after refresh", () => {
    const fullCmd = "{ for i in $(seq 1 20); do echo \"A-$i\"; sleep 1; done } & { for i in $(seq 1 20); do echo \"B-$i\"; sleep 1; done } & wait";
    const jsonArgs = JSON.stringify({ command: fullCmd, description: "Run A and B in parallel with wait", timeout: 25 });
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-refresh", [
        bashBlock({
          toolCallId: "llm-tool-call-xyz",
          args: jsonArgs,
          status: "running",
          output: "",
          startedAt: 1000,
        }),
      ]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({
          toolCallId: "bash-channel-abc",
          command: fullCmd,
          output: "B-1\nA-1\nA-2\nB-2\n",
        }),
      ),
    );

    reconcileChatToolFromBashEvent(
      SID,
      outputEvent(
        runningProcess({
          toolCallId: "bash-channel-abc",
          command: fullCmd,
          output: "B-1\nA-1\nA-2\nB-2\nB-3\nA-3\nB-4\nA-4\n",
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks[0].output).toBe(
      "B-1\nA-1\nA-2\nB-2\nB-3\nA-3\nB-4\nA-4\n",
    );
  });
});

describe("syncBashStoreToChat — replay bash store into chat after load", () => {
  // Simulates the post-refresh race condition: bash events (or the bash
  // history) arrive BEFORE the chat messages are loaded. The bash store
  // has the output, but the chat block doesn't. After loadSessionMessages
  // populates the chat, syncBashStoreToChat must fold the bash store's
  // output into the chat block, otherwise the user sees the dynamic output
  // in the bash panel sidebar but the chat's "Output" section is empty.

  it("folds a running bash process output into the chat block after refresh", () => {
    const fullCmd = "{ for i in $(seq 1 20); do echo \"A-$i\"; sleep 1; done } & { for i in $(seq 1 20); do echo \"B-$i\"; sleep 1; done } & wait";
    const jsonArgs = JSON.stringify({ command: fullCmd, description: "Run A and B in parallel with wait", timeout: 25 });
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-refresh", [
        bashBlock({
          toolCallId: "llm-tool-call-xyz",
          args: jsonArgs,
          status: "running",
          output: "",
          startedAt: 1000,
        }),
      ]),
    ]);

    // Bash store already has the streamed output (events arrived during load)
    useBashStore.getState().upsertProcess(SID, {
      toolCallId: "bash-channel-abc",
      command: fullCmd,
      cwd: "/tmp/project",
      startedAt: 1000,
      output: "B-1\nA-1\nA-2\nB-2\nB-3\nA-3\n",
      status: "running",
    });

    syncBashStoreToChat(SID);

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].output).toBe("B-1\nA-1\nA-2\nB-2\nB-3\nA-3\n");
    expect(blocks[0].status).toBe("running");
  });

  it("folds a completed bash process into the chat block with final output", () => {
    const cmd = "echo done";
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-refresh", [
        bashBlock({ toolCallId: "llm-id", args: cmd, status: "running" }),
      ]),
    ]);

    useBashStore.getState().upsertProcess(SID, {
      toolCallId: "bash-id",
      command: cmd,
      cwd: "/tmp",
      startedAt: 1000,
      endedAt: 2000,
      output: "done\n",
      exitCode: 0,
      status: "done",
    });

    syncBashStoreToChat(SID);

    const blocks = toolBlocks();
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("done\n");
  });

  it("is a no-op when the bash store is empty", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock()]),
    ]);
    syncBashStoreToChat(SID);
    const blocks = toolBlocks();
    expect(blocks[0].output).toBe("");
    expect(blocks[0].status).toBe("running");
  });

  it("is a no-op when the chat has no messages", () => {
    useBashStore.getState().upsertProcess(SID, {
      toolCallId: "abc",
      command: "echo x",
      cwd: "/tmp",
      startedAt: 0,
      output: "x\n",
      status: "done",
    });
    expect(() => syncBashStoreToChat(SID)).not.toThrow();
  });

  it("syncs multiple parallel bash processes with distinct commands", () => {
    // In real parallel bash, each tool call has a distinct command — the
    // semantic match works correctly because commands differ. (When two
    // parallel calls share a command, the LLM's tool_use.id and the bash
    // channel's toolCallId are the same, so the exact match path applies
    // and there is no ambiguity.)
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-refresh", [
        bashBlock({ toolCallId: "llm-A", args: "echo A", status: "running" }),
        bashBlock({ toolCallId: "llm-B", args: "echo B", status: "running" }),
      ]),
    ]);

    useBashStore.setState((s) => ({
      ...s,
      processesBySession: {
        ...s.processesBySession,
        [SID]: [
          { toolCallId: "bash-A", command: "echo A", cwd: "/tmp", startedAt: 0, output: "A-out\n", status: "running" },
          { toolCallId: "bash-B", command: "echo B", cwd: "/tmp", startedAt: 0, output: "B-out\n", status: "running" },
        ],
      },
    }));

    syncBashStoreToChat(SID);

    const blocks = toolBlocks();
    const blockA = blocks.find((b) => b.toolCallId === "llm-A");
    const blockB = blocks.find((b) => b.toolCallId === "llm-B");
    expect(blockA?.output).toBe("A-out\n");
    expect(blockB?.output).toBe("B-out\n");
  });

  it("is idempotent — calling twice does not double-update the output", () => {
    const cmd = "echo idempotent";
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock({ args: cmd, toolCallId: "llm-1" })]),
    ]);
    useBashStore.getState().upsertProcess(SID, {
      toolCallId: "bash-1",
      command: cmd,
      cwd: "/tmp",
      startedAt: 0,
      output: "first output\n",
      status: "running",
    });

    syncBashStoreToChat(SID);
    syncBashStoreToChat(SID);

    const blocks = toolBlocks();
    expect(blocks[0].output).toBe("first output\n");
  });
});
