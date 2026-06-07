/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  appendFullJsonlEntry,
  appendUiJsonlEntry,
  buildBranchPathIds,
  filterMessagesToBranch,
  paginateEntryMessages,
  type FullMessageAccumulator,
} from "../src/shared/agent/session-jsonl-messages";

function makeAccumulator(): FullMessageAccumulator {
  return {
    allMessages: [],
    allCustomEntries: [],
    allCompactionEntries: [],
    parentById: new Map(),
    lastJsonlLeafPointer: null,
  };
}

describe("session JSONL message helpers", () => {
  it("appends UI custom, compaction, and optional message entries with branch filtering", () => {
    const messages: unknown[] = [];
    const customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> =
      [];
    const activePathIds = new Set(["custom-1", "compact-1", "message-1"]);

    appendUiJsonlEntry({
      parsed: {
        type: "custom",
        id: "custom-1",
        customType: "notice",
        data: { ok: true },
        timestamp: "2026-06-05T00:00:00.000Z",
      },
      messages,
      customEntries,
      activePathIds,
      includeMessages: true,
    });
    appendUiJsonlEntry({
      parsed: { type: "compaction", id: "compact-1", summary: "", tokensBefore: 10, timestamp: 1 },
      messages,
      customEntries,
      activePathIds,
      includeMessages: true,
    });
    appendUiJsonlEntry({
      parsed: { type: "message", id: "message-2", message: { role: "user" } },
      messages,
      customEntries,
      activePathIds,
      includeMessages: true,
    });

    expect(customEntries).toEqual([
      {
        id: "custom-1",
        customType: "notice",
        data: { ok: true },
        timestamp: Date.parse("2026-06-05T00:00:00.000Z"),
      },
    ]);
    expect(messages).toEqual([
      { id: "compact-1", role: "compactionSummary", summary: "", tokensBefore: 10, timestamp: 1 },
    ]);
  });

  it("accumulates full JSONL entries and preserves compaction order", () => {
    const accumulator = makeAccumulator();

    appendFullJsonlEntry(
      { type: "message", id: "m1", parentId: null, message: { role: "user", text: "A" } },
      accumulator,
    );
    appendFullJsonlEntry(
      {
        type: "compaction",
        id: "c1",
        parentId: "m1",
        summary: "compressed",
        tokensBefore: 100,
        timestamp: 2,
      },
      accumulator,
    );
    appendFullJsonlEntry(
      { type: "leaf_pointer", leafId: "c1" },
      accumulator,
    );

    expect(accumulator.allMessages).toEqual([
      { entryId: "m1", message: { role: "user", text: "A" } },
      {
        entryId: "c1",
        message: {
          role: "compactionSummary",
          summary: "compressed",
          tokensBefore: 100,
          timestamp: 2,
        },
      },
    ]);
    expect(accumulator.allCompactionEntries).toEqual([
      { entryId: "c1", summary: "compressed", tokensBefore: 100, timestamp: 2 },
    ]);
    expect(accumulator.lastJsonlLeafPointer).toBe("c1");
  });

  it("builds branch path IDs and filters messages/custom entries to the active branch", () => {
    const parentById = new Map<string, string | null>([
      ["root", null],
      ["left", "root"],
      ["right", "root"],
    ]);

    expect(buildBranchPathIds(parentById, "left")).toEqual(new Set(["left", "root"]));

    const result = filterMessagesToBranch({
      allMessages: [
        { entryId: "root", message: { role: "user" } },
        { entryId: "left", message: { role: "assistant", branch: "left" } },
        { entryId: "right", message: { role: "assistant", branch: "right" } },
      ],
      allCustomEntries: [
        { id: "left", customType: "tool", data: "left", timestamp: 1 },
        { id: "right", customType: "tool", data: "right", timestamp: 1 },
      ],
      parentById,
      leafId: "left",
    });

    expect(result.leafFound).toBe(true);
    expect(result.filteredMessages.map((m) => m.entryId)).toEqual(["root", "left"]);
    expect(result.customEntries.map((entry) => entry.id)).toEqual(["left"]);
  });

  it("paginates from newest and supports older-page cursors", () => {
    const filteredMessages = [
      { entryId: "m1", message: { role: "user" } },
      { entryId: "m2", message: { role: "assistant" } },
      { entryId: "m3", message: { role: "user" } },
      { entryId: "m4", message: { role: "assistant" } },
    ];

    expect(paginateEntryMessages({ filteredMessages, limit: 2 })).toEqual({
      slicedMessages: [
        { role: "user", entryId: "m3" },
        { role: "assistant", entryId: "m4" },
      ],
      hasMore: true,
      nextCursor: "m3",
    });

    expect(paginateEntryMessages({ filteredMessages, limit: 2, afterEntryId: "m3" })).toEqual({
      slicedMessages: [
        { role: "user", entryId: "m1" },
        { role: "assistant", entryId: "m2" },
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("expands a paginated toolCall window with its matching toolResult", () => {
    const filteredMessages = [
      { entryId: "u1", message: { role: "user" } },
      {
        entryId: "a1",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "bash" }],
        },
      },
      { entryId: "r1", message: { role: "toolResult", toolCallId: "tool-1" } },
      { entryId: "a2", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    ];

    expect(paginateEntryMessages({ filteredMessages, limit: 1, afterEntryId: "r1" })).toEqual({
      slicedMessages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "bash" }],
          entryId: "a1",
        },
        { role: "toolResult", toolCallId: "tool-1", entryId: "r1" },
      ],
      hasMore: true,
      nextCursor: "a1",
    });
  });

  it("expands a paginated toolResult window with its matching toolCall", () => {
    const filteredMessages = [
      { entryId: "u1", message: { role: "user" } },
      {
        entryId: "a1",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "bash" }],
        },
      },
      { entryId: "r1", message: { role: "toolResult", toolCallId: "tool-1" } },
    ];

    expect(paginateEntryMessages({ filteredMessages, limit: 1 })).toEqual({
      slicedMessages: [
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "bash" }],
          entryId: "a1",
        },
        { role: "toolResult", toolCallId: "tool-1", entryId: "r1" },
      ],
      hasMore: true,
      nextCursor: "r1",
    });
  });

  it("transitively expands parallel tool calls when only one result is in window", () => {
    // Reproduces the bug where an assistant message has 4 parallel bash
    // tool calls. The pagination window includes only the last toolResult,
    // which backward-expands to the assistant message. The assistant message
    // must then forward-expand to include the other 3 toolResults.
    const filteredMessages = [
      { entryId: "u1", message: { role: "user", content: [{ type: "text", text: "run 4 commands" }] } },
      {
        entryId: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running 4 commands in parallel" },
            { type: "toolCall", id: "tool-1", name: "bash" },
            { type: "toolCall", id: "tool-2", name: "bash" },
            { type: "toolCall", id: "tool-3", name: "bash" },
            { type: "toolCall", id: "tool-4", name: "bash" },
          ],
        },
      },
      { entryId: "r1", message: { role: "toolResult", toolCallId: "tool-1" } },
      { entryId: "r2", message: { role: "toolResult", toolCallId: "tool-2" } },
      { entryId: "r3", message: { role: "toolResult", toolCallId: "tool-3" } },
      { entryId: "r4", message: { role: "toolResult", toolCallId: "tool-4" } },
      { entryId: "a2", message: { role: "assistant", content: [{ type: "text", text: "All done" }] } },
    ];

    // limit: 1 → window = [6, 7) = only a2 (index 6)
    // a2 has no tool calls/results, so no expansion needed
    // But with limit: 2 → window = [5, 7) = r4 (index 5) + a2 (index 6)
    // r4 backward-expands to a1 (index 1), then a1 forward-expands to r1-r3 (indices 2-5)
    const result = paginateEntryMessages({ filteredMessages, limit: 2 });

    // All 7 entries should be included (a1, r1, r2, r3, r4, a2 + user message excluded since before window)
    // Actually: window starts at index 5, so entries before that are NOT included
    // unless expanded. r4 at index 5 is in window → backward expand a1 at index 1
    // → a1 forward expand r1 (2), r2 (3), r3 (4), r4 (5 already included)
    expect(result.slicedMessages).toHaveLength(6); // a1 + r1 + r2 + r3 + r4 + a2

    // Verify all toolResults are present
    const resultIds = result.slicedMessages.map((m: { toolCallId?: string }) => m.toolCallId).filter(Boolean);
    expect(resultIds).toContain("tool-1");
    expect(resultIds).toContain("tool-2");
    expect(resultIds).toContain("tool-3");
    expect(resultIds).toContain("tool-4");
  });
});
