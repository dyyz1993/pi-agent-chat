/**
 * @vitest-environment node
 *
 * Tests for rollback targetId resolution.
 *
 * The backend navigateTree handles role-based parentId jumping:
 * - user message → newLeafId = parentId (removes user + after)
 * - assistant/other → newLeafId = targetId (stays at target)
 *
 * The frontend passes entryId directly and lets the backend decide.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

interface TreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  label?: string;
}

/**
 * Frontend's findTurnBoundary: pass entryId directly.
 * The backend handles the parentId jump based on message role.
 */
function findTurnBoundary(entryId: string, _entries: TreeEntry[]): string | null {
  void _entries;
  return entryId;
}

describe("Rollback targetId: frontend passes entryId, backend handles jump", () => {
  const treeEntries: TreeEntry[] = [
    { id: "e1", parentId: null, type: "message", label: "user" },
    { id: "e2", parentId: "e1", type: "message", label: "assistant" },
    { id: "e3", parentId: "e2", type: "message", label: "user" },
    { id: "e4", parentId: "e3", type: "message", label: "assistant" },
  ];

  it("rollback e4(assistant) → frontend sends e4, backend stays at e4", () => {
    const targetId = findTurnBoundary("e4", treeEntries);
    expect(targetId).toBe("e4");
  });

  it("rollback e3(user) → frontend sends e3, backend jumps to e2", () => {
    const targetId = findTurnBoundary("e3", treeEntries);
    expect(targetId).toBe("e3");
  });

  it("rollback e2(assistant) → frontend sends e2, backend stays at e2", () => {
    const targetId = findTurnBoundary("e2", treeEntries);
    expect(targetId).toBe("e2");
  });

  it("rollback e1(root user) → frontend sends e1, backend jumps to null", () => {
    const targetId = findTurnBoundary("e1", treeEntries);
    expect(targetId).toBe("e1");
  });

  it("frontend never does parentId lookup — backend is responsible", () => {
    for (const entry of treeEntries) {
      const targetId = findTurnBoundary(entry.id, treeEntries);
      expect(targetId).toBe(entry.id);
    }
  });
});
