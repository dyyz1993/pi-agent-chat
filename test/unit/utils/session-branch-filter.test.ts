import { describe, expect, it } from "vitest";
import { applyPagination } from "../../../src/shared/agent/session-branch-filter";
import type { ParsedMessageEntry } from "../../../src/shared/agent/session-jsonl-parser";

function makeEntry(index: number): ParsedMessageEntry {
  return {
    entryId: `entry-${index}`,
    message: {
      id: `msg-${index}`,
      role: "user",
      content: [{ type: "text", text: `Message ${index}` }],
    },
  };
}

function makeBranch(count: number): ParsedMessageEntry[] {
  return Array.from({ length: count }, (_, i) => makeEntry(i));
}

describe("applyPagination", () => {
  it("returns the newest page when no cursor is given", () => {
    const result = applyPagination(makeBranch(10), { limit: 3 });
    expect(result.messages).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("entry-7");
  });

  it("returns the page before a valid cursor", () => {
    const result = applyPagination(makeBranch(10), { limit: 3, afterEntryId: "entry-5" });
    expect(result.messages).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("entry-2");
  });

  it("reports hasMore=false when the oldest page is reached via a valid cursor", () => {
    const result = applyPagination(makeBranch(10), { limit: 3, afterEntryId: "entry-2" });
    expect(result.messages).toHaveLength(2);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  // Regression: a stale cursor (branch restructured by compaction/rollback/fork)
  // used to return an empty page with hasMore=false, which permanently disabled
  // upward loading. It must instead fall back to the newest page so the client
  // re-anchors its cursor and recovers on the next page-up.
  it("falls back to the newest page when the cursor is stale (not found)", () => {
    const result = applyPagination(makeBranch(10), { limit: 3, afterEntryId: "entry-gone" });
    expect(result.messages).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("entry-7");
  });
});
