/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readDraft, writeDraft } from "../../../src/mainview/utils/chat-input-draft";
import { hasSameMessageSnapshots } from "../../../src/mainview/utils/chat-message-snapshot";
import { isAgentNotStartedError } from "../../../src/mainview/lib/chat-send-utils";
import {
  buildPreservedStreamingMessage,
  shouldAppendPreservedStreamingMessage,
} from "../../../src/mainview/lib/chat-tool-normalizer";
import type { ChatMessage } from "../../../src/mainview/types";

const storage = new Map<string, string>();

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
  configurable: true,
});

afterEach(() => {
  storage.clear();
});

describe("chat store helpers", () => {
  it("stores, reads, and clears per-session input drafts", () => {
    writeDraft("sess-1", "hello");
    writeDraft("sess-2", "world");

    expect(readDraft("sess-1")).toBe("hello");
    expect(readDraft("sess-2")).toBe("world");

    writeDraft("sess-1", "");

    expect(readDraft("sess-1")).toBe("");
    expect(readDraft("sess-2")).toBe("world");
  });

  it("compares message snapshots by visible revision fields", () => {
    const current: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1,
      },
    ];
    const same: ChatMessage[] = [{ ...current[0], content: [{ type: "text", text: "hello" }] }];
    const changed: ChatMessage[] = [{ ...current[0], content: [{ type: "text", text: "bye" }] }];

    expect(hasSameMessageSnapshots(current, same)).toBe(true);
    expect(hasSameMessageSnapshots(current, changed)).toBe(false);
  });

  it("detects stale agent process send failures for the active session", () => {
    expect(
      isAgentNotStartedError(
        new Error("Agent not started for session sess-123"),
        "sess-123",
      ),
    ).toBe(true);
    expect(
      isAgentNotStartedError(
        new Error("Agent not started for session sess-other"),
        "sess-123",
      ),
    ).toBe(false);
  });

  it("does not preserve a stale streaming tool card when history already has its terminal result", () => {
    const finalMsgs: ChatMessage[] = [
      {
        id: "assistant-final",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "read",
            args: "src/main.ts",
            status: "done",
            output: "ok",
          },
        ],
        timestamp: 2,
      },
    ];
    const staleStreamingMsg: ChatMessage = {
      id: "assistant-live",
      role: "assistant",
      isStreaming: true,
      content: [
        {
          type: "toolExecution",
          toolCallId: "tc-1",
          toolName: "read",
          args: "src/main.ts",
          status: "running",
        },
      ],
      timestamp: 1,
    };

    expect(shouldAppendPreservedStreamingMessage(finalMsgs, staleStreamingMsg)).toBe(false);
  });

  it("preserves streaming cards that do not have a terminal result in history yet", () => {
    const finalMsgs: ChatMessage[] = [
      {
        id: "assistant-final",
        role: "assistant",
        content: [{ type: "text", text: "still thinking" }],
        timestamp: 2,
      },
    ];
    const streamingMsg: ChatMessage = {
      id: "assistant-live",
      role: "assistant",
      isStreaming: true,
      content: [
        {
          type: "toolExecution",
          toolCallId: "tc-2",
          toolName: "write",
          args: "src/main.ts",
          status: "running",
        },
      ],
      timestamp: 1,
    };

    expect(shouldAppendPreservedStreamingMessage(finalMsgs, streamingMsg)).toBe(true);
  });

  it("preserves only unfinished streaming tool cards when history has mixed terminal results", () => {
    const finalMsgs: ChatMessage[] = [
      {
        id: "assistant-final",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-done",
            toolName: "read",
            args: "done.ts",
            status: "done",
            output: "ok",
          },
        ],
        timestamp: 2,
      },
    ];
    const streamingMsg: ChatMessage = {
      id: "assistant-live",
      role: "assistant",
      isStreaming: true,
      content: [
        { type: "text", text: "duplicate text from live stream" },
        {
          type: "toolExecution",
          toolCallId: "tc-done",
          toolName: "read",
          args: "done.ts",
          status: "running",
        },
        {
          type: "toolExecution",
          toolCallId: "tc-running",
          toolName: "write",
          args: "pending.ts",
          status: "running",
        },
      ],
      timestamp: 1,
    };

    const preserved = buildPreservedStreamingMessage(finalMsgs, streamingMsg);

    // Text block should be preserved (not in JSONL during streaming)
    // tc-done (read "done.ts") is deduped against terminal in finalMsgs
    // tc-running (write "pending.ts") is preserved (not in finalMsgs)
    expect(preserved?.content).toHaveLength(2);
    expect(preserved?.content[0]).toMatchObject({
      type: "text",
      text: "duplicate text from live stream",
    });
    expect(preserved?.content[1]).toMatchObject({
      type: "toolExecution",
      toolCallId: "tc-running",
      status: "running",
    });
  });
});
