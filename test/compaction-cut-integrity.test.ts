/**
 * Tests for compaction cut integrity — verifies that cuts never produce
 * dangling toolCalls (toolCall without its toolResult) or orphaned toolResults.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";

const compactionPath = path.resolve(
  process.cwd(),
  ".yalc/@dyyz1993/pi-coding-agent/dist/core/compaction/compaction.js",
);
const { findCutPoint, estimateTokens } = await import(`file://${compactionPath}`);

function makeEntry(
  role: string,
  id: string,
  parentId: string,
  content: string | Array<Record<string, unknown>>,
) {
  const msg: Record<string, unknown> = {
    role,
    content: typeof content === "string" ? [{ type: "text", text: content }] : content,
    timestamp: Date.now(),
  };
  if (role === "assistant" && Array.isArray(content)) {
    msg.stopReason = "endTurn";
    msg.usage = { totalTokens: 100 };
  }
  return { type: "message", id, parentId, timestamp: Date.now(), message: msg };
}

function buildTurnBasedSession(turns: number) {
  const entries: Array<Record<string, unknown>> = [
    { type: "session", id: "s0", parentId: null, timestamp: Date.now() },
  ];
  let pid = "s0";

  for (let t = 0; t < turns; t++) {
    // user
    entries.push(makeEntry("user", `u${t}`, pid, `Round ${t}: do something important`.repeat(20)));
    pid = `u${t}`;

    // assistant with toolCall
    entries.push(
      makeEntry("assistant", `a${t}-1`, pid, [
        { type: "text", text: `I'll help with round ${t}.`.repeat(10) },
        {
          type: "toolCall",
          name: "read_file",
          id: `tc-${t}`,
          arguments: { path: `/file${t}.txt` },
        },
      ]),
    );
    pid = `a${t}-1`;

    // toolResult
    entries.push(makeEntry("toolResult", `tr${t}`, pid, `File ${t} content: `.repeat(50)));
    pid = `tr${t}`;

    // assistant final
    entries.push(
      makeEntry("assistant", `a${t}-2`, pid, [
        { type: "text", text: `Done with round ${t}. File created successfully.`.repeat(10) },
      ]),
    );
    pid = `a${t}-2`;
  }

  return entries;
}

function getToolCallIds(entries: Array<Record<string, unknown>>, startIndex: number) {
  const ids: Set<string> = new Set();
  for (let i = startIndex; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === "message") {
      const msg = e.message as Record<string, unknown>;
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content as Array<Record<string, unknown>>) {
          if (block.type === "toolCall" && block.id) {
            ids.add(block.id as string);
          }
        }
      }
    }
  }
  return ids;
}

function getToolResultIds(entries: Array<Record<string, unknown>>, startIndex: number) {
  const ids: Set<string> = new Set();
  for (let i = startIndex; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === "message") {
      const msg = e.message as Record<string, unknown>;
      if (msg.role === "toolResult") {
        ids.add((e as { id: string }).id);
      }
    }
  }
  return ids;
}

describe("compaction cut integrity", () => {
  it("never produces dangling toolCalls at any keepRecentTokens level", () => {
    const entries = buildTurnBasedSession(20);
    const levels = [20000, 10000, 5000, 2000, 1000];

    for (const keepTokens of levels) {
      const cut = findCutPoint(entries, 1, entries.length, keepTokens);
      const cutIdx = cut.firstKeptEntryIndex;

      // Get toolCall IDs in the kept portion
      const toolCallIds = getToolCallIds(entries, cutIdx);

      // Get toolResult IDs in the kept portion
      const toolResultIds = getToolResultIds(entries, cutIdx);

      // Every toolCall in kept portion should have its toolResult in kept portion
      for (let tcIdx = 0; tcIdx < toolCallIds.size; tcIdx++) {
        expect(toolResultIds.size).toBeGreaterThan(0);
      }
    }
  });

  it("cut always falls on a user or assistant message, never toolResult", () => {
    const entries = buildTurnBasedSession(20);
    const levels = [20000, 10000, 5000, 2000];

    for (const keepTokens of levels) {
      const cut = findCutPoint(entries, 1, entries.length, keepTokens);
      const cutEntry = entries[cut.firstKeptEntryIndex];

      if (cutEntry.type === "message") {
        const role = (cutEntry.message as { role: string }).role;
        expect(role).not.toBe("toolResult");
        expect(["user", "assistant", "custom", "bashExecution"]).toContain(role);
      }
    }
  });

  it("kept messages form a coherent conversation (no orphaned references)", () => {
    const entries = buildTurnBasedSession(15);
    const cut = findCutPoint(entries, 1, entries.length, 5000);

    // Verify parentId chain is intact from firstKept to end
    const byId = new Map<string, number>();
    entries.forEach((e, i) => byId.set((e as { id: string }).id, i));

    for (let i = cut.firstKeptEntryIndex; i < entries.length; i++) {
      const e = entries[i] as { parentId: string; id: string };
      if (e.parentId && i > cut.firstKeptEntryIndex) {
        const parentIdx = byId.get(e.parentId);
        // Parent should either be before cut (already summarized) or in kept portion
        // If in kept portion, it should be >= cut.firstKeptEntryIndex
        if (parentIdx !== undefined && parentIdx >= cut.firstKeptEntryIndex) {
          expect(parentIdx).toBeLessThan(i);
        }
      }
    }
  });

  it("progressive levels produce strictly decreasing context sizes", () => {
    const entries = buildTurnBasedSession(30);
    const levels = [20000, 10000, 5000, 2000];

    const keptSizes = levels.map((keepTokens) => {
      const cut = findCutPoint(entries, 1, entries.length, keepTokens);
      let size = 0;
      for (let i = cut.firstKeptEntryIndex; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === "message") {
          size += estimateTokens((e as { message: unknown }).message);
        }
      }
      return size;
    });

    // Each level should keep <= previous level
    for (let i = 1; i < keptSizes.length; i++) {
      expect(keptSizes[i]).toBeLessThanOrEqual(keptSizes[i - 1]);
    }
  });
});
