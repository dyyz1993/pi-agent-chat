/**
 * @vitest-environment node
 *
 * Tests for getFullMessages leaf→root path filtering in AgentProcessManager.
 * Verifies that after rollback, getFullMessages only returns messages on
 * the current branch (leaf→root path), not all messages in the JSONL file.
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { AgentProcessManager as APM } from "../src/shared/agent/process-manager";
import { AgentProcessManager } from "../src/shared/agent/process-manager";

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

const TMP_DIR = join("/tmp", "pi-getFullMessages-test");

// JSONL entry helpers
function msgEntry(id: string, parentId: string | null, role: string, text: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    message: { role, content: text },
    timestamp: new Date().toISOString(),
  });
}

function customEntry(
  id: string,
  parentId: string | null,
  customType: string,
  data: Record<string, unknown>,
): string {
  return JSON.stringify({
    id,
    parentId,
    type: "custom",
    customType,
    data,
    timestamp: new Date().toISOString(),
  });
}

function leafPointerEntry(leafId: string): string {
  return JSON.stringify({
    id: `leaf-${leafId}`,
    parentId: null,
    type: "leaf_pointer",
    leafId,
    timestamp: new Date().toISOString(),
  });
}

describe("getFullMessages leaf→root path filtering", () => {
  let manager: APM;
  let sessionFile: string;

  beforeEach(() => {
    manager = new AgentProcessManager(new MockRPCServer());
    mkdirSync(TMP_DIR, { recursive: true });
    sessionFile = join(TMP_DIR, `session-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in temp directory
    }
  });

  it("returns all messages when no leafId is set", async () => {
    // Linear tree: e1 → e2 → e3 → e4
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "how are you"),
        msgEntry("e4", "e3", "assistant", "fine"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(4);
    expect(result.totalCount).toBe(4);
    expect(result.customEntries).toHaveLength(0);
  });

  it("filters to leaf→root path after rollback", async () => {
    // Tree structure:
    //   e1 → e2 → e3 → e4  (branch A)
    //              ↘ e5 → e6  (branch B, branching from e2)
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "branch-A-msg"),
        msgEntry("e4", "e3", "assistant", "branch-A-reply"),
        msgEntry("e5", "e2", "user", "branch-B-msg"),
        msgEntry("e6", "e5", "assistant", "branch-B-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // Rollback to e2 (leaf is now e2)
    internals(manager).leafIds.set("s1", "e2");

    const result = await manager.getFullMessages("s1", sessionFile);

    // Should only return e1 + e2 (the path from e2 → e1)
    expect(result.messages).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("uses a JSONL leaf pointer at EOF as the active rollback leaf", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "old branch"),
        msgEntry("e4", "e3", "assistant", "old reply"),
        leafPointerEntry("e2"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    expect(result.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["e1", "e2"]);
  });

  it("advances the active leaf when entries are appended after a JSONL leaf pointer", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "old branch"),
        msgEntry("e4", "e3", "assistant", "old reply"),
        leafPointerEntry("e2"),
        msgEntry("e5", "e2", "user", "new branch"),
        msgEntry("e6", "e5", "assistant", "new reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(4);
    expect(result.totalCount).toBe(4);
    const entryIds = result.messages.map((m) => (m as { entryId?: string }).entryId);
    expect(entryIds).toEqual(["e1", "e2", "e5", "e6"]);
    expect(entryIds).not.toContain("e3");
    expect(entryIds).not.toContain("e4");
  });

  it("filters to a different branch", async () => {
    // Same tree, but leaf is at e6 (branch B)
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "branch-A-msg"),
        msgEntry("e4", "e3", "assistant", "branch-A-reply"),
        msgEntry("e5", "e2", "user", "branch-B-msg"),
        msgEntry("e6", "e5", "assistant", "branch-B-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // Leaf at e6 → path is e6 → e5 → e2 → e1
    internals(manager).leafIds.set("s1", "e6");

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(4);
    expect(result.totalCount).toBe(4);
    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("filters custom entries along with messages", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        customEntry("e3", "e2", "file-review-turn", { turnIndex: 1 }),
        msgEntry("e4", "e3", "user", "more"),
        msgEntry("e5", "e4", "assistant", "reply"),
        customEntry("e6", "e3", "memory_prefetch", { query: "test" }),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // Rollback to e3 → path is e3 → e2 → e1
    internals(manager).leafIds.set("s1", "e3");

    const result = await manager.getFullMessages("s1", sessionFile);

    // Messages: e1, e2 (on path). e4, e5 are off-path.
    expect(result.messages).toHaveLength(2);
    expect(result.totalCount).toBe(2);
    // Custom: e3 (on path). e6 is off-path.
    expect(result.customEntries).toHaveLength(1);
    expect(result.customEntries[0].customType).toBe("file-review-turn");
  });

  it("returns empty messages when leaf is root with no messages", async () => {
    // Only custom entries, no messages on the path
    writeFileSync(
      sessionFile,
      [
        customEntry("e1", null, "session_info", { name: "test" }),
        msgEntry("e2", "e1", "user", "hello"),
        msgEntry("e3", "e2", "assistant", "hi"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // Leaf at e1 (root, only custom entry)
    internals(manager).leafIds.set("s1", "e1");

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    // e1 is a custom entry on path
    expect(result.customEntries).toHaveLength(1);
  });

  it("pagination respects filtered count", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "more"),
        msgEntry("e4", "e3", "assistant", "reply"),
        msgEntry("e5", "e2", "user", "branch-B"),
        msgEntry("e6", "e5", "assistant", "branch-B-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // Leaf at e4 → path e4→e3→e2→e1 (4 messages)
    internals(manager).leafIds.set("s1", "e4");

    const result = await manager.getFullMessages("s1", sessionFile, { limit: 2 });

    // Total filtered is 4, but limit=2 → get last 2
    expect(result.messages).toHaveLength(2);
    expect(result.totalCount).toBe(4);
    expect(result.hasMore).toBe(true);
  });

  it("uses afterEntryId cursor to return the previous page", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "start"),
        msgEntry("e2", "e1", "assistant", "reply"),
        msgEntry("e3", "e2", "user", "more"),
        msgEntry("e4", "e3", "assistant", "reply-2"),
        msgEntry("e5", "e4", "user", "again"),
        msgEntry("e6", "e5", "assistant", "reply-3"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    internals(manager).leafIds.set("s1", "e6");

    const latest = await manager.getFullMessages("s1", sessionFile, { limit: 2 });

    expect(latest.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["e5", "e6"]);
    expect(latest.hasMore).toBe(true);
    expect(latest.nextCursor).toBe("e5");

    const previous = await manager.getFullMessages("s1", sessionFile, {
      limit: 2,
      afterEntryId: latest.nextCursor ?? undefined,
    });

    expect(previous.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual([
      "e3",
      "e4",
    ]);
    expect(previous.hasMore).toBe(true);
    expect(previous.nextCursor).toBe("e3");
  });

  it("handles session with no JSONL file gracefully", async () => {
    internals(manager).sessionPaths.set("s1", "/nonexistent/path.jsonl");
    internals(manager).leafIds.set("s1", "e1");

    const result = await manager.getFullMessages("s1", "/nonexistent/path.jsonl");

    expect(result.messages).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.customEntries).toHaveLength(0);
  });

  it("stale leafId not in JSONL returns all messages instead of filtering to zero", async () => {
    // This is the bug the user hit: leafId from cache doesn't exist in the JSONL
    // (e.g. from a different session or expired cache). Without the safety check,
    // the path would be empty → all messages filtered out → user sees nothing.
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "more"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);
    // leafId that doesn't exist in the JSONL file
    internals(manager).leafIds.set("s1", "nonexistent-entry-id");

    const result = await manager.getFullMessages("s1", sessionFile);

    // Should return ALL messages (unfiltered) because the leafId is not found
    expect(result.messages).toHaveLength(3);
    expect(result.totalCount).toBe(3);
  });

  it("end-to-end: rollback then getFullMessages shows fewer messages", async () => {
    // Simulates the full frontend flow:
    // 1. Session has 3 turns (6 messages)
    // 2. User rolls back to turn 1 (2 messages)
    // 3. Frontend calls getFullMessages → should see 2 messages

    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "turn-1-prompt"),
        msgEntry("e2", "e1", "assistant", "turn-1-reply"),
        msgEntry("e3", "e2", "user", "turn-2-prompt"),
        msgEntry("e4", "e3", "assistant", "turn-2-reply"),
        msgEntry("e5", "e4", "user", "turn-3-prompt"),
        msgEntry("e6", "e5", "assistant", "turn-3-reply"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    // Step 1: Before rollback, full session → 6 messages
    const before = await manager.getFullMessages("s1", sessionFile);
    expect(before.messages).toHaveLength(6);
    const beforeUserMsgs = before.messages.filter(
      (m: Record<string, unknown>) => m.role === "user",
    );
    expect(beforeUserMsgs).toHaveLength(3);

    // Step 2: Simulate rollback — navigateTree sets leafId to e2
    // (this is what process-manager.navigateTree does on success)
    internals(manager).leafIds.set("s1", "e2");

    // Step 3: Frontend calls loadSessionMessages({ force: true })
    // → getFullMessages with the new leafId
    const after = await manager.getFullMessages("s1", sessionFile);

    // Should only see e1 + e2 (2 messages, 1 user, 1 assistant)
    expect(after.messages).toHaveLength(2);
    expect(after.totalCount).toBe(2);
    const afterUserMsgs = after.messages.filter((m: Record<string, unknown>) => m.role === "user");
    expect(afterUserMsgs).toHaveLength(1);

    // Verify the "rollback effective" check that RollbackOverlay does:
    // afterCount (2) < beforeCount (6) → rollback is effective
    expect(after.messages.length).toBeLessThan(before.messages.length);
  });

  it("end-to-end: rollback to root leaves only root message", async () => {
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "initial"),
        msgEntry("e2", "e1", "assistant", "reply"),
        msgEntry("e3", "e2", "user", "followup"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    const before = await manager.getFullMessages("s1", sessionFile);
    expect(before.messages).toHaveLength(3);

    // Rollback to e1 (root)
    internals(manager).leafIds.set("s1", "e1");

    const after = await manager.getFullMessages("s1", sessionFile);
    expect(after.messages).toHaveLength(1);
    expect(after.totalCount).toBe(1);
    expect((after.messages[0] as Record<string, unknown>).role).toBe("user");
  });

  it("end-to-end: rollback then continue creates new branch", async () => {
    // After rollback, user sends new message → new branch
    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "turn-1"),
        msgEntry("e2", "e1", "assistant", "reply-1"),
        msgEntry("e3", "e2", "user", "turn-2"),
        msgEntry("e4", "e3", "assistant", "reply-2"),
        // New branch from e2 after rollback
        msgEntry("e5", "e2", "user", "new-turn-2"),
        msgEntry("e6", "e5", "assistant", "new-reply-2"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    // User is now on new branch: e6 → e5 → e2 → e1
    internals(manager).leafIds.set("s1", "e6");

    const result = await manager.getFullMessages("s1", sessionFile);

    expect(result.messages).toHaveLength(4);
    expect(result.totalCount).toBe(4);
    // e3, e4 should NOT be in the result (they're on the old branch)
    const texts = result.messages.map((m: Record<string, unknown>) => (m.content as string) ?? "");
    expect(texts).not.toContain("turn-2");
    expect(texts).not.toContain("reply-2");
    expect(texts).toContain("new-turn-2");
  });

  it("rollback then continue chatting: new messages are included after leafId refresh", async () => {
    // Simulates the scenario:
    // 1. Session has e1→e2→e3→e4 (2 turns)
    // 2. Rollback to e2 (leafIds cache = "e2")
    // 3. Continue chatting → e5→e6 appended to JSONL
    // 4. getFullMessages should return e1→e2→e5→e6 (NOT filtered to old e2)
    //
    // This tests the fix for: after rollback + continue, new messages were
    // filtered out because leafIds cache held the old rollback target.

    writeFileSync(
      sessionFile,
      [
        msgEntry("e1", null, "user", "hello"),
        msgEntry("e2", "e1", "assistant", "hi"),
        msgEntry("e3", "e2", "user", "more"),
        msgEntry("e4", "e3", "assistant", "reply"),
        // New messages after rollback + continue:
        msgEntry("e5", "e2", "user", "new question"),
        msgEntry("e6", "e5", "assistant", "new answer"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("s1", sessionFile);

    // Step 1: Simulate rollback — set leafId to e2 (old value)
    internals(manager).leafIds.set("s1", "e2");

    // Step 2: Simulate CLI has moved leaf to e6 (after continuing chat)
    // In real code, getTreeWithLeaf() would return e6.
    // But our test uses no managed client, so it falls back to leafIds cache.
    // To simulate the bug, keep old cache:
    //   leafId = "e2" → path e2→e1 → only 2 messages → e5/e6 missing!

    // With old cache (simulating the bug):
    const resultWithOldCache = await manager.getFullMessages("s1", sessionFile);
    // This returns e1+e2 because leafIds=e2, but e5/e6 are NOT on e2→e1 path
    expect(resultWithOldCache.messages).toHaveLength(2);

    // Step 3: Update leafIds to latest (what getTreeWithLeaf would return)
    internals(manager).leafIds.set("s1", "e6");

    const resultWithNewLeaf = await manager.getFullMessages("s1", sessionFile);
    // Now path is e6→e5→e2→e1 → 4 messages
    expect(resultWithNewLeaf.messages).toHaveLength(4);
    const roles = resultWithNewLeaf.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });
});

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}
