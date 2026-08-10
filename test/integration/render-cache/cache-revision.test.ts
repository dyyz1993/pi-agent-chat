/**
 * Regression tests for render-cache revision computation.
 *
 * Bug: computeMessagesRevision only checked the LAST block's output size.
 * During parallel tool execution (e.g. two bash commands streaming output
 * simultaneously), updates to non-last blocks were invisible because the
 * cache revision didn't change → stale render → "waiting" shown forever.
 *
 * These tests ensure the revision captures changes in ALL rendered fields,
 * including streamed tool args, so the render cache invalidates correctly.
 */
import { describe, it, expect } from "vitest";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";
import {
  computeMessagesRevision,
  getProcessedMessagesForSession,
} from "../../../src/mainview/components/chat/MessageListView";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
type TextBlock = Extract<ContentBlock, { type: "text" }>;

function makeAssistantMessage(blocks: ContentBlock[], id = "msg-1"): ChatMessage {
  return { id, role: "assistant", content: blocks, timestamp: Date.now() };
}

function makeTextBlock(text: string): TextBlock {
  return { type: "text", text };
}

function makeToolBlock(
  toolCallId: string,
  status: "running" | "done" | "error",
  output = "",
  args = '{"command":"echo test"}',
  toolName = "bash",
): ToolExecBlock {
  return {
    type: "toolExecution",
    toolCallId,
    toolName,
    args,
    status,
    output,
    startedAt: Date.now(),
    ...(status !== "running" ? { endedAt: Date.now() } : {}),
  };
}

describe("computeMessagesRevision — parallel tool execution", () => {
  // ================================================================
  // THE CORE REGRESSION: updating a non-last block MUST change the
  // revision. This was the exact bug that caused parallel bash
  // streaming to be invisible.
  // ================================================================
  it("changes when a NON-last tool block's output grows (parallel streaming)", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([
        makeTextBlock("Running two commands..."),
        makeToolBlock("call_a96", "running", ""), // ← non-last, empty
        makeToolBlock("call_9c0", "running", ""), // ← last, empty
      ]),
    ];

    const rev1 = computeMessagesRevision(messages);

    // Simulate tool_execution_update for call_a96 (the NON-last block)
    const updated: ChatMessage[] = [
      makeAssistantMessage([
        makeTextBlock("Running two commands..."),
        makeToolBlock("call_a96", "running", "1\n2\n3\n"), // ← GREW
        makeToolBlock("call_9c0", "running", ""), // ← unchanged
      ]),
    ];

    const rev2 = computeMessagesRevision(updated);

    // MUST be different — this is what triggers cache invalidation
    expect(rev2).not.toBe(rev1);
  });

  it("changes when the LAST tool block's output grows", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_a96", "running", "1\n"),
        makeToolBlock("call_9c0", "running", ""),
      ]),
    ];

    const rev1 = computeMessagesRevision(messages);

    const updated: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_a96", "running", "1\n"),
        makeToolBlock("call_9c0", "running", "1\n"), // ← grew
      ]),
    ];

    const rev2 = computeMessagesRevision(updated);
    expect(rev2).not.toBe(rev1);
  });

  it("changes when BOTH blocks grow in the same update cycle", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_a96", "running", "1\n"),
        makeToolBlock("call_9c0", "running", "1\n"),
      ]),
    ];

    const rev1 = computeMessagesRevision(messages);

    const updated: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_a96", "running", "1\n2\n"),
        makeToolBlock("call_9c0", "running", "1\n2\n"),
      ]),
    ];

    const rev2 = computeMessagesRevision(updated);
    expect(rev2).not.toBe(rev1);
  });

  it("stays the same when NO blocks changed (cache stability)", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([
        makeTextBlock("Done."),
        makeToolBlock("call_a96", "done", "1\n2\n3\n"),
        makeToolBlock("call_9c0", "done", "1\n2\n3\n"),
      ]),
    ];

    const rev1 = computeMessagesRevision(messages);
    const rev2 = computeMessagesRevision(messages);
    expect(rev1).toBe(rev2);
  });

  it("detects block count change (new tool added)", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([makeToolBlock("call_a96", "running", "")]),
    ];

    const rev1 = computeMessagesRevision(messages);

    const updated: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_a96", "running", ""),
        makeToolBlock("call_9c0", "running", ""), // ← new block
      ]),
    ];

    const rev2 = computeMessagesRevision(updated);
    expect(rev2).not.toBe(rev1);
  });

  it("changes while streamed write args reveal the file path", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([makeToolBlock("write-1", "running", "", "{}", "write")]),
    ];
    const rev1 = computeMessagesRevision(messages);

    const updated: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("write-1", "running", "", '{"path":"src/App.tsx"}', "write"),
      ]),
    ];
    const rev2 = computeMessagesRevision(updated);

    expect(rev2).not.toBe(rev1);
  });

  it("invalidates processed-message cache when streamed tool args change", () => {
    const sessionId = "streamed-write-args";
    const initialMessages: ChatMessage[] = [
      makeAssistantMessage([makeToolBlock("write-2", "running", "", "{}", "write")]),
    ];
    const initial = getProcessedMessagesForSession({
      activeSessionId: sessionId,
      visibleMessages: initialMessages,
      showMemoryEntries: true,
    });

    const updatedArgs = '{"path":"src/components/StreamingCard.tsx"}';
    const updatedMessages: ChatMessage[] = [
      makeAssistantMessage([makeToolBlock("write-2", "running", "", updatedArgs, "write")]),
    ];
    const updated = getProcessedMessagesForSession({
      activeSessionId: sessionId,
      visibleMessages: updatedMessages,
      showMemoryEntries: true,
    });

    expect(updated).not.toBe(initial);
    expect(updated[0]?.msg.content[0]).toMatchObject({
      type: "toolExecution",
      args: updatedArgs,
      status: "running",
    });
  });

  it("detects status change even when output length stays the same", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([makeToolBlock("call_a96", "running", "done output")]),
    ];

    const rev1 = computeMessagesRevision(messages);

    const updated: ChatMessage[] = [
      makeAssistantMessage([makeToolBlock("call_a96", "done", "done output")]),
    ];

    const rev2 = computeMessagesRevision(updated);
    expect(rev2).not.toBe(rev1);
  });

  // ================================================================
  // Full parallel bash simulation: 10 rounds of updates, verifying
  // EVERY round produces a different revision.
  // ================================================================
  it("every streaming round produces a unique revision (parallel bash × 10)", () => {
    let messages: ChatMessage[] = [
      makeAssistantMessage([
        makeTextBlock("Running parallel bash..."),
        makeToolBlock("call_a96", "running", ""),
        makeToolBlock("call_9c0", "running", ""),
      ]),
    ];

    const revisions: string[] = [computeMessagesRevision(messages)];

    for (let i = 1; i <= 10; i++) {
      const text = Array.from({ length: i }, (_, j) => String(j + 1)).join("\n") + "\n";
      messages = [
        makeAssistantMessage([
          makeTextBlock("Running parallel bash..."),
          makeToolBlock("call_a96", "running", text),
          makeToolBlock("call_9c0", "running", text),
        ]),
      ];
      revisions.push(computeMessagesRevision(messages));
    }

    // All 11 revisions (initial + 10 rounds) must be unique
    const unique = new Set(revisions);
    expect(unique.size).toBe(revisions.length);
  });

  // ================================================================
  // Edge cases
  // ================================================================
  it("handles empty messages array", () => {
    expect(computeMessagesRevision([])).toBe("0");
  });

  it("handles message with no blocks", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "assistant", content: [], timestamp: Date.now() },
    ];
    const rev = computeMessagesRevision(messages);
    expect(rev).toContain("msg-1");
  });

  it("handles 3+ parallel tool blocks", () => {
    const messages: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_1", "running", ""),
        makeToolBlock("call_2", "running", ""),
        makeToolBlock("call_3", "running", ""),
      ]),
    ];

    const rev1 = computeMessagesRevision(messages);

    // Update the FIRST block (call_1)
    const updated: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_1", "running", "output 1\n"),
        makeToolBlock("call_2", "running", ""),
        makeToolBlock("call_3", "running", ""),
      ]),
    ];

    const rev2 = computeMessagesRevision(updated);
    expect(rev2).not.toBe(rev1);

    // Update the MIDDLE block (call_2)
    const updated2: ChatMessage[] = [
      makeAssistantMessage([
        makeToolBlock("call_1", "running", "output 1\n"),
        makeToolBlock("call_2", "running", "output 2\n"),
        makeToolBlock("call_3", "running", ""),
      ]),
    ];

    const rev3 = computeMessagesRevision(updated2);
    expect(rev3).not.toBe(rev2);
  });
});
