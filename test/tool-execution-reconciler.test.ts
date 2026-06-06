import { describe, expect, it } from "vitest";
import type { ChatMessage, ContentBlock } from "../src/mainview/types";
import {
  buildPreservedStreamingMessage,
  dedupeToolExecutions,
  findMatchingPendingToolExecution,
  formatArgsFromRawInput,
  getToolCallInput,
  getToolExecutionDedupeKeys,
  hasOverlappingToolExecutionKeys,
  normalizeToolArgsForMatch,
  toolExecutionItemToBlock,
} from "../src/mainview/lib/tool-execution-reconciler";

function toolExecution(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "tc-1",
    toolName: "bash",
    args: "npm run build",
    status: "running",
    ...overrides,
  };
}

function assistant(
  id: string,
  content: ContentBlock[],
  isStreaming = false,
): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: 1,
    isStreaming,
  };
}

describe("tool execution reconciler", () => {
  it("normalizes SDK toolCall arguments and UI toolCall input through the same accessor", () => {
    expect(
      getToolCallInput({
        type: "toolCall",
        id: "tc-ui",
        name: "bash",
        input: "npm run build",
      }),
    ).toBe("npm run build");

    expect(
      getToolCallInput({
        type: "toolCall",
        id: "tc-sdk",
        name: "bash",
        input: undefined as unknown as string,
        arguments: { command: "npm run build" },
      }),
    ).toEqual({ command: "npm run build" });
  });

  it("formats raw object args with description metadata", () => {
    expect(
      formatArgsFromRawInput({ command: "npm run build", description: "workspace build" }),
    ).toEqual({
      args: JSON.stringify({ command: "npm run build", description: "workspace build" }, null, 2),
      description: "workspace build",
    });
  });

  it("extracts description metadata from raw JSON string args", () => {
    const raw = JSON.stringify({ description: "commit M7.2.1" }, null, 2);

    expect(formatArgsFromRawInput(raw)).toEqual({
      args: raw,
      description: "commit M7.2.1",
    });
  });

  it("normalizes bash command args from plain text and JSON", () => {
    expect(normalizeToolArgsForMatch("npm run build")).toBe("npm run build");
    expect(normalizeToolArgsForMatch(JSON.stringify({ command: "npm run build" }))).toBe(
      "npm run build",
    );
  });

  it("matches bash executions by command even when call ids differ", () => {
    const live = toolExecution({ toolCallId: "tc-live", args: "npm run build" });
    const history = toolExecution({
      toolCallId: "tc-history",
      args: JSON.stringify({ command: "npm run build", description: "build" }),
      status: "done",
    });

    expect(hasOverlappingToolExecutionKeys(live, history)).toBe(true);
    expect(getToolExecutionDedupeKeys(live)).toContain("semantic:bash:command:npm run build");
  });

  it("matches file mutations across absolute and project-relative paths", () => {
    const absolute = toolExecution({
      toolCallId: "tc-live-write",
      toolName: "write",
      args: JSON.stringify({
        path: "/Users/xuyingzhou/Project/study-rust/browser/crates/gui/Cargo.toml",
      }),
    });
    const relative = toolExecution({
      toolCallId: "tc-history-write",
      toolName: "write",
      args: JSON.stringify({ path: "crates/gui/Cargo.toml" }),
      status: "done",
    });

    expect(hasOverlappingToolExecutionKeys(absolute, relative)).toBe(true);
  });

  it("does not merge read and write operations for the same path", () => {
    const read = toolExecution({
      toolCallId: "tc-read",
      toolName: "read",
      args: JSON.stringify({ path: "src/main.ts" }),
    });
    const write = toolExecution({
      toolCallId: "tc-write",
      toolName: "write",
      args: JSON.stringify({ path: "src/main.ts" }),
      status: "done",
    });

    expect(hasOverlappingToolExecutionKeys(read, write)).toBe(false);
  });

  it("deduplicates running and terminal executions with terminal winning", () => {
    const messages: ChatMessage[] = [
      assistant("live", [
        toolExecution({
          toolCallId: "tc-live",
          args: "cargo clippy --workspace",
          status: "running",
          output: "waiting...",
        }),
      ]),
      assistant("history", [
        toolExecution({
          toolCallId: "tc-history",
          args: JSON.stringify({ command: "cargo clippy --workspace" }),
          status: "done",
          output: "finished",
        }),
      ]),
    ];

    dedupeToolExecutions(messages);

    const blocks = messages.flatMap((msg) =>
      msg.content.filter(
        (block): block is Extract<ContentBlock, { type: "toolExecution" }> =>
          block.type === "toolExecution",
      ),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolCallId).toBe("tc-history");
    expect(blocks[0].status).toBe("done");
  });

  it("does not preserve stale streaming tools when terminal history exists", () => {
    const finalMessages = [
      assistant("history", [
        toolExecution({
          toolCallId: "tc-history",
          args: JSON.stringify({ command: "npm test" }),
          status: "done",
        }),
      ]),
    ];
    const streaming = assistant(
      "live",
      [toolExecution({ toolCallId: "tc-live", args: "npm test", status: "running" })],
      true,
    );

    expect(buildPreservedStreamingMessage(finalMessages, streaming)).toBeUndefined();
  });

  it("does not preserve stale streaming tools when terminal history only matches by description", () => {
    const finalMessages: ChatMessage[] = [
      {
        id: "history",
        role: "assistant",
        content: [
          toolExecution({
            toolCallId: "tc-history-result",
            args: "",
            description: "commit M7.2.1",
            status: "error",
            output: "syntax error",
          }),
        ],
        timestamp: 2,
      },
    ];
    const streaming: ChatMessage = {
      id: "live",
      role: "assistant",
      content: [
        toolExecution({
          toolCallId: "tc-live-running",
          args: "",
          description: "commit M7.2.1",
          status: "running",
        }),
      ],
      timestamp: 1,
      isStreaming: true,
    };

    expect(buildPreservedStreamingMessage(finalMessages, streaming)).toBeUndefined();
  });

  it("preserves a newer streaming tool even when an older terminal has the same description", () => {
    const finalMessages: ChatMessage[] = [
      {
        id: "history",
        role: "assistant",
        content: [
          toolExecution({
            toolCallId: "tc-history-result",
            args: "",
            description: "workspace 验收",
            status: "done",
            output: "passed",
          }),
        ],
        timestamp: 1,
      },
    ];
    const streaming: ChatMessage = {
      id: "live",
      role: "assistant",
      content: [
        toolExecution({
          toolCallId: "tc-live-running",
          args: "",
          description: "workspace 验收",
          status: "running",
        }),
      ],
      timestamp: 2,
      isStreaming: true,
    };

    const preserved = buildPreservedStreamingMessage(finalMessages, streaming);
    expect(preserved?.content).toHaveLength(1);
    expect(
      preserved?.content[0].type === "toolExecution" ? preserved.content[0].toolCallId : "",
    ).toBe("tc-live-running");
  });

  it("preserves still-running streaming tools that history has not completed", () => {
    const finalMessages = [
      assistant("history", [
        toolExecution({
          toolCallId: "tc-history",
          args: JSON.stringify({ command: "npm test" }),
          status: "done",
        }),
      ]),
    ];
    const streaming = assistant(
      "live",
      [toolExecution({ toolCallId: "tc-live-next", args: "npm run lint", status: "running" })],
      true,
    );

    const preserved = buildPreservedStreamingMessage(finalMessages, streaming);
    expect(preserved?.content).toHaveLength(1);
    expect(
      preserved?.content[0].type === "toolExecution" ? preserved.content[0].toolCallId : "",
    ).toBe("tc-live-next");
  });

  it("finds pending live execution by shared identity for realtime starts", () => {
    const blocks: ContentBlock[] = [
      toolExecution({
        toolCallId: "tc-message-update",
        args: JSON.stringify({ command: "cargo test" }),
        status: "running",
      }),
    ];

    expect(findMatchingPendingToolExecution(blocks, "bash", "cargo test")).toBe(0);
  });

  it("does not match terminal blocks for realtime start reconciliation", () => {
    const blocks: ContentBlock[] = [
      toolExecution({
        toolCallId: "tc-terminal",
        args: JSON.stringify({ command: "cargo test" }),
        status: "done",
      }),
    ];

    expect(findMatchingPendingToolExecution(blocks, "bash", "cargo test")).toBe(-1);
  });

  it("converts timeline tool items back to blocks for shared identity checks", () => {
    const block = toolExecutionItemToBlock({
      itemType: "toolExecution",
      blockIndex: 0,
      toolCallId: "tc-item",
      toolName: "bash",
      args: "npm run build",
      status: "running",
      messageId: "m1",
    });

    expect(block).toEqual({
      type: "toolExecution",
      toolCallId: "tc-item",
      toolName: "bash",
      args: "npm run build",
      status: "running",
      output: undefined,
      details: undefined,
    });
  });
});
