import { beforeEach, describe, expect, it } from "vitest";
import type { BashChannelEvent, BashProcess } from "../src/shared/modules/bash";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";
import { reconcileChatToolFromBashEvent } from "../src/mainview/stores/session-subscriptions";
import { useChatStore } from "../src/mainview/stores/use-chat-store";

const SID = "bash-reconcile-session";

function bashBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "tool-live",
    toolName: "bash",
    args: "cargo test",
    status: "running",
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

function process(overrides: Partial<BashProcess> = {}): BashProcess {
  return {
    toolCallId: "tool-live",
    command: "cargo test",
    cwd: "/tmp/project",
    startedAt: 1000,
    endedAt: 2000,
    output: "finished\n",
    status: "done",
    exitCode: 0,
    ...overrides,
  };
}

function event(proc: BashProcess): BashChannelEvent {
  return {
    type: proc.status === "terminated" ? "terminated" : proc.status === "error" ? "error" : "end",
    toolCallId: proc.toolCallId,
    processes: [proc],
    timestamp: proc.endedAt ?? 2000,
  };
}

function toolBlocks(): Extract<ContentBlock, { type: "toolExecution" }>[] {
  return (useChatStore.getState().messagesBySession[SID] ?? []).flatMap((msg) =>
    msg.content.filter(
      (block): block is Extract<ContentBlock, { type: "toolExecution" }> =>
        block.type === "toolExecution",
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

describe("reconcileChatToolFromBashEvent", () => {
  it("closes the matching running bash card by exact toolCallId", () => {
    useChatStore.getState().setMessagesForSession(SID, [assistant("msg-1", [bashBlock()])]);

    reconcileChatToolFromBashEvent(SID, event(process()));

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("finished\n");
    expect(blocks[0].endedAt).toBe(2000);
  });

  it("closes a single running bash card by command when bash process id differs", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [bashBlock({ toolCallId: "message-update-id", args: "cargo test" })]),
    ]);

    reconcileChatToolFromBashEvent(SID, event(process({ toolCallId: "bash-process-id" })));

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("message-update-id");
    expect(blocks[0].status).toBe("done");
    expect(blocks[0].output).toBe("finished\n");
  });

  it("closes exact toolCallId match while leaving same-command sibling untouched", () => {
    useChatStore.getState().setMessagesForSession(SID, [
      assistant("msg-1", [
        bashBlock({ toolCallId: "message-update-id-1", args: "cargo test" }),
        bashBlock({ toolCallId: "message-update-id-2", args: "cargo test" }),
      ]),
    ]);

    reconcileChatToolFromBashEvent(
      SID,
      event(process({ toolCallId: "message-update-id-2", output: "exact done\n" })),
    );

    // Both blocks survive — cross-message semantic dedup was removed.
    // Only the exact toolCallId match is reconciled.
    const blocks = toolBlocks();
    expect(blocks).toHaveLength(2);
    const closed = blocks.find((b) => b.toolCallId === "message-update-id-2");
    const sibling = blocks.find((b) => b.toolCallId === "message-update-id-1");
    expect(closed).toBeDefined();
    expect(closed!.status).toBe("done");
    expect(closed!.output).toBe("exact done\n");
    expect(sibling).toBeDefined();
    expect(sibling!.status).toBe("running");
  });

  it("marks terminated bash processes as error with terminated details", () => {
    useChatStore.getState().setMessagesForSession(SID, [assistant("msg-1", [bashBlock()])]);

    reconcileChatToolFromBashEvent(
      SID,
      event(
        process({
          status: "terminated",
          exitCode: 2,
          output: "",
          error: "cancelled",
        }),
      ),
    );

    const blocks = toolBlocks();
    expect(blocks).toHaveLength(1);
    expect(blocks[0].status).toBe("error");
    expect(blocks[0].output).toBe("cancelled");
    expect(blocks[0].details).toMatchObject({
      terminated: { command: "cargo test", exitCode: 2 },
    });
  });
});
