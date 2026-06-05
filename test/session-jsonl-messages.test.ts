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
});
