/**
 * @vitest-environment node
 *
 * TDD tests for rollback targetId resolution.
 *
 * From first principles: "rolling back message X" means "remove X and everything after it".
 * In the tree, that means navigateTree(parentId of X), NOT navigateTree(X itself).
 * Because the leaf→root path INCLUDES the leaf, so navigateTree(X) keeps X visible.
 *
 * Tree structure for tests:
 *   e1(user) → e2(assistant) → e3(user) → e4(assistant)
 *
 * Rollback e4(assistant) → user wants e4 gone → targetId = e3 (e4's parent)
 * Rollback e3(user) → user wants e3 AND e4 gone → targetId = e2 (e3's parent)
 * Rollback e2(assistant) → user wants e2, e3, e4 gone → targetId = e1 (e2's parent)
 * Rollback e1(user) → user wants everything gone → targetId = e1's parent (root/null)
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

// ── Tree entry type ──
interface TreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  label?: string;
}

// ── Helpers ──
const TMP_DIR = join("/tmp", "pi-rollback-targetid-test");

function msgLine(id: string, parentId: string | null, role: string, text: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    message: { role, content: text },
    timestamp: new Date().toISOString(),
  });
}

function buildTreeFile(
  entries: Array<{ id: string; parentId: string | null; role: string; text: string }>,
): string {
  const filePath = join(TMP_DIR, `session-${Date.now()}.jsonl`);
  const lines = entries.map((e) => msgLine(e.id, e.parentId, e.role, e.text));
  writeFileSync(filePath, lines.join("\n"));
  return filePath;
}

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

// ── The function under test: findRollbackTarget ──
// This is the correct logic we want to implement.
// For now it mirrors what the frontend does (return entryId itself),
// so tests will FAIL until we fix it.

/**
 * Given a tree and the entryId the user clicked "rollback" on,
 * return the correct targetId for navigateTree().
 *
 * Rule: rolling back message X means "remove X and everything after it".
 * Since navigateTree(targetId) makes targetId the new leaf, and the
 * leaf→root path INCLUDES the leaf, we need to set leaf = parentId of X
 * so that X itself is excluded from the path.
 *
 * Exception: if X is the root (parentId is null), rolling back means
 * removing everything. We can't navigate to null, so this case needs
 * special handling (or should be blocked by UI).
 */
function findRollbackTarget(entryId: string, entries: TreeEntry[]): string | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const entry = byId.get(entryId);
  if (!entry) return null;

  // Current frontend behavior (WRONG):
  // return entryId;

  // Correct behavior: return parentId so the clicked message is excluded
  const parentId = entry.parentId;
  if (!parentId) {
    // This is the root message. Can't rollback further.
    // Return null to signal "can't rollback the root".
    return null;
  }
  return parentId;
}

describe("Rollback targetId resolution (first principles)", () => {
  let manager: APM;

  // Our test tree:
  // e1(user) → e2(assistant) → e3(user) → e4(assistant)
  const treeEntries = [
    { id: "e1", parentId: null, role: "user", text: "write a function" },
    { id: "e2", parentId: "e1", role: "assistant", text: "here it is" },
    { id: "e3", parentId: "e2", role: "user", text: "add tests" },
    { id: "e4", parentId: "e3", role: "assistant", text: "tests added" },
  ];

  beforeEach(() => {
    manager = new AgentProcessManager(new MockRPCServer());
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("rollback e4(assistant) → targetId should be e3, e4 removed", async () => {
    const sessionFile = buildTreeFile(treeEntries);
    internals(manager).sessionPaths.set("s1", sessionFile);

    const treeForLookup = treeEntries.map((e) => ({
      id: e.id,
      parentId: e.parentId,
      type: "message",
      label: e.role,
    }));

    const targetId = findRollbackTarget("e4", treeForLookup);
    expect(targetId).toBe("e3");

    // Set leaf to targetId and verify via getFullMessages
    internals(manager).leafIds.set("s1", targetId!);
    const result = await manager.getFullMessages("s1", sessionFile);

    // Should have e1, e2, e3 (3 messages). e4 is gone.
    expect(result.messages).toHaveLength(3);
    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
  });

  it("rollback e3(user) → targetId should be e2, e3 AND e4 removed", async () => {
    const sessionFile = buildTreeFile(treeEntries);
    internals(manager).sessionPaths.set("s1", sessionFile);

    const treeForLookup = treeEntries.map((e) => ({
      id: e.id,
      parentId: e.parentId,
      type: "message",
      label: e.role,
    }));

    const targetId = findRollbackTarget("e3", treeForLookup);
    expect(targetId).toBe("e2");

    internals(manager).leafIds.set("s1", targetId!);
    const result = await manager.getFullMessages("s1", sessionFile);

    // Should have e1, e2 (2 messages). e3 and e4 are gone.
    expect(result.messages).toHaveLength(2);
    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("rollback e2(assistant) → targetId should be e1, only e1 remains", async () => {
    const sessionFile = buildTreeFile(treeEntries);
    internals(manager).sessionPaths.set("s1", sessionFile);

    const treeForLookup = treeEntries.map((e) => ({
      id: e.id,
      parentId: e.parentId,
      type: "message",
      label: e.role,
    }));

    const targetId = findRollbackTarget("e2", treeForLookup);
    expect(targetId).toBe("e1");

    internals(manager).leafIds.set("s1", targetId!);
    const result = await manager.getFullMessages("s1", sessionFile);

    // Only e1 remains
    expect(result.messages).toHaveLength(1);
    expect((result.messages[0] as Record<string, unknown>).role).toBe("user");
  });

  it("rollback e1(root user) → targetId should be null, cannot rollback root", () => {
    const treeForLookup = treeEntries.map((e) => ({
      id: e.id,
      parentId: e.parentId,
      type: "message",
      label: e.role,
    }));

    const targetId = findRollbackTarget("e1", treeForLookup);
    expect(targetId).toBeNull();
  });

  it("WRONG: current frontend behavior — targetId=e4 keeps e4 visible", async () => {
    const sessionFile = buildTreeFile(treeEntries);
    internals(manager).sessionPaths.set("s1", sessionFile);

    // Current frontend behavior: targetId = entryId itself
    internals(manager).leafIds.set("s1", "e4");
    const result = await manager.getFullMessages("s1", sessionFile);

    // BUG: all 4 messages returned, e4 is still there
    expect(result.messages).toHaveLength(4);
    const roles = result.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });
});
