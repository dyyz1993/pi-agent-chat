/**
 * Test: buildPreservedStreamingMessage preserves text content
 * during background refresh while streaming.
 *
 * Bug: After page refresh during streaming, the streaming assistant
 * message (text + tool execution) was lost because
 * buildPreservedStreamingMessage only kept running toolExecution blocks,
 * dropping all text/thinking content.
 */
import { describe, it, expect } from "vitest";
import { buildPreservedStreamingMessage } from "../../../src/mainview/lib/tool-execution-reconciler";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";

describe("buildPreservedStreamingMessage - streaming content preservation", () => {
  it("should preserve text blocks from streaming message", () => {
    const finalMsgs: ChatMessage[] = [
      { id: "u1", role: "user", content: [{ type: "text", text: "run ls" }], timestamp: 1000 },
    ];

    const streamingMsg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [
        { type: "text", text: "I'll run ls for you." },
        { type: "toolExecution", toolCallId: "tc1", toolName: "bash", args: "ls", status: "running" },
      ],
      timestamp: 2000,
      isStreaming: true,
    };

    const result = buildPreservedStreamingMessage(finalMsgs, streamingMsg);

    expect(result).toBeDefined();
    expect(result!.content.length).toBe(2);
    expect(result!.content[0].type).toBe("text");
    expect(result!.content[1].type).toBe("toolExecution");
  });

  it("should preserve streaming message with ONLY text (no tools)", () => {
    const finalMsgs: ChatMessage[] = [
      { id: "u1", role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1000 },
    ];

    const streamingMsg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "Hi! How can I help you?" }],
      timestamp: 2000,
      isStreaming: true,
    };

    const result = buildPreservedStreamingMessage(finalMsgs, streamingMsg);

    expect(result).toBeDefined();
    expect(result!.content.length).toBe(1);
    expect(result!.content[0].type).toBe("text");
  });

  it("should preserve thinking blocks from streaming message", () => {
    const finalMsgs: ChatMessage[] = [
      { id: "u1", role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1000 },
    ];

    const streamingMsg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me think about this..." },
        { type: "text", text: "Here's my answer." },
      ],
      timestamp: 2000,
      isStreaming: true,
    };

    const result = buildPreservedStreamingMessage(finalMsgs, streamingMsg);

    expect(result).toBeDefined();
    expect(result!.content.length).toBe(2);
  });

  it("should still dedup toolExecution against terminal blocks in JSONL", () => {
    const finalMsgs: ChatMessage[] = [
      {
        id: "a0",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc_old",
            toolName: "bash",
            args: '{"command":"ls -la"}',
            status: "done",
            output: "file1.txt",
          } as Extract<ContentBlock, { type: "toolExecution" }>,
        ],
        timestamp: 500,
      },
    ];

    const streamingMsg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [
        { type: "text", text: "Running ls again..." },
        {
          type: "toolExecution",
          toolCallId: "tc_new",
          toolName: "bash",
          args: '{"command":"ls -la"}',
          status: "running",
        },
      ],
      timestamp: 2000,
      isStreaming: true,
    };

    const result = buildPreservedStreamingMessage(finalMsgs, streamingMsg);

    // Text should be preserved
    expect(result).toBeDefined();
    const textBlocks = result!.content.filter((b) => b.type === "text");
    expect(textBlocks.length).toBe(1);

    // The running tool with same command as terminal should be deduped
    const toolBlocks = result!.content.filter((b) => b.type === "toolExecution");
    // tc_new has command "ls -la" which matches the terminal block's command
    // so it should be filtered out (dedup by description)
    expect(toolBlocks.length).toBe(0);
  });

  it("should return undefined for non-streaming message", () => {
    const finalMsgs: ChatMessage[] = [];
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [{ type: "text", text: "done" }],
      timestamp: 2000,
      // isStreaming not set
    };

    const result = buildPreservedStreamingMessage(finalMsgs, msg);
    expect(result).toBeUndefined();
  });

  it("should return undefined for empty streaming content", () => {
    const finalMsgs: ChatMessage[] = [];
    const streamingMsg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: [],
      timestamp: 2000,
      isStreaming: true,
    };

    const result = buildPreservedStreamingMessage(finalMsgs, streamingMsg);
    expect(result).toBeUndefined();
  });
});
