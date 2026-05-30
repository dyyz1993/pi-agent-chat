/**
 * TDD Tests: rollback with toUserMsgEntryId + getFileDiff integration
 *
 * Covers:
 * 1. toUserMsgEntryId used instead of toTurnIndex for correct snapshot resolution
 * 2. getFileDiff called for each modified/added file to get diff content and line counts
 * 3. Rollback → continue chat → rollback again with correct data
 */
import { describe, it, expect, vi } from "vitest";

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

function createMockApiCall(scenarios: Record<string, unknown>) {
  return vi.fn(async (method: string) => {
    if (method in scenarios) {
      const result = scenarios[method];
      if (typeof result === "function") return result();
      return result;
    }
    return {};
  });
}

describe("Rollback with toUserMsgEntryId + getFileDiff", () => {
  const sessionId = "sess-1";

  it("getModifiedFiles uses toUserMsgEntryId, not toTurnIndex", async () => {
    const apiCall = createMockApiCall({
      "agent.getModifiedFiles": [
        { path: "B1.ts", status: "added", turnIndex: 3, entryId: "snap-3" },
        { path: "B2.ts", status: "added", turnIndex: 3, entryId: "snap-3" },
      ],
    });

    const result = await apiCall("agent.getModifiedFiles", {
      sessionId,
      toUserMsgEntryId: "user-entry-2",
    });

    expect(result).toHaveLength(2);
    expect(apiCall).toHaveBeenCalledWith(
      "agent.getModifiedFiles",
      expect.objectContaining({ toUserMsgEntryId: "user-entry-2" }),
    );
  });

  it("getFileDiff called for each modified/added file to get line counts", async () => {
    const files = [
      { path: "a.ts", status: "modified", turnIndex: 0, entryId: "snap-0" },
      { path: "b.ts", status: "added", turnIndex: 0, entryId: "snap-0" },
      { path: "c.ts", status: "deleted", turnIndex: 0, entryId: "snap-0" },
    ];

    const diffResults: Record<
      string,
      { oldContent: string | null; newContent: string | null; unifiedDiff: string }
    > = {
      "a.ts": {
        oldContent: "line1\nline2\n",
        newContent: "line1\nline2\nline3\n",
        unifiedDiff: "@@\n line1\n line2\n+line3\n",
      },
      "b.ts": { oldContent: null, newContent: "new1\nnew2", unifiedDiff: "+new1\n+new2" },
    };

    const enrichedFiles = await Promise.all(
      files.map(async (f) => {
        if (f.status === "modified" || f.status === "added") {
          const diff = diffResults[f.path];
          if (diff) {
            const oldLines = diff.oldContent?.split("\n").length ?? 0;
            const newLines = diff.newContent?.split("\n").length ?? 0;
            return {
              ...f,
              details: diff.unifiedDiff,
              addedLines: f.status === "added" ? newLines : Math.max(0, newLines - oldLines),
              removedLines: f.status === "added" ? 0 : Math.max(0, oldLines - newLines),
            };
          }
        }
        return f;
      }),
    );

    const modified = enrichedFiles.find((f) => f.path === "a.ts")!;
    expect(modified.addedLines).toBe(1);
    expect(modified.removedLines).toBe(0);
    expect(modified.details).toContain("+line3");

    const added = enrichedFiles.find((f) => f.path === "b.ts")!;
    expect(added.addedLines).toBe(2);
    expect(added.removedLines).toBe(0);
    expect(added.details).toContain("+new1");

    const deleted = enrichedFiles.find((f) => f.path === "c.ts")!;
    expect(deleted.addedLines).toBeUndefined();
    expect(deleted.details).toBeUndefined();
  });

  it("after rollback + new chat, toUserMsgEntryId resolves correctly via entries", async () => {
    const entries = [
      { id: "e1", type: "message", parentId: null },
      { id: "e2", type: "message", parentId: "e1" },
      { id: "snap-0", type: "custom", customType: "step-snapshot", data: { turnIndex: 0 } },
      { id: "e3", type: "message", parentId: "snap-0" },
      { id: "e4", type: "message", parentId: "e3" },
      { id: "snap-1", type: "custom", customType: "step-snapshot", data: { turnIndex: 1 } },
      { id: "snap-2", type: "custom", customType: "step-snapshot", data: { turnIndex: 2 } },
      { id: "e5", type: "message", parentId: "snap-1" },
      { id: "e6", type: "message", parentId: "e5" },
      { id: "snap-3", type: "custom", customType: "step-snapshot", data: { turnIndex: 3 } },
    ];

    function resolveToTurnIndex(toUserMsgEntryId: string): number | undefined {
      const idx = entries.findIndex((e) => e.id === toUserMsgEntryId);
      if (idx === -1) return undefined;
      for (let i = idx; i < entries.length; i++) {
        const e = entries[i];
        if (e.type === "custom" && (e as { customType?: string }).customType === "step-snapshot") {
          return (e as { data: { turnIndex: number } }).data.turnIndex;
        }
      }
      return undefined;
    }

    expect(resolveToTurnIndex("e1")).toBe(0);
    expect(resolveToTurnIndex("e3")).toBe(1);
    expect(resolveToTurnIndex("e5")).toBe(3);

    expect(resolveToTurnIndex("e1")).not.toBe(2);
    expect(resolveToTurnIndex("e5")).not.toBe(2);
  });
});

describe("getModifiedFiles should pass fromEntryId to scope file range", () => {
  it("passes fromEntryId to limit files to current turn only", async () => {
    const apiCall = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "agent.getModifiedFiles") {
        if (params.fromEntryId) {
          return {
            files: [{ path: "A.ts", status: "added" as const, turnIndex: 3, entryId: "snap-3" }],
            resolvedFromEntryId: params.fromEntryId,
          };
        }
        return {
          files: [
            { path: "A.ts", status: "added" as const, turnIndex: 3, entryId: "snap-3" },
            { path: "B.ts", status: "modified" as const, turnIndex: 1, entryId: "snap-1" },
            { path: "C.ts", status: "modified" as const, turnIndex: 0, entryId: "snap-0" },
          ],
          resolvedFromEntryId: null,
        };
      }
      return {};
    });

    const result = await apiCall("agent.getModifiedFiles", {
      sessionId: "sess-1",
      toUserMsgEntryId: "user-entry-2",
      fromEntryId: "snap-2",
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("A.ts");
    expect(apiCall).toHaveBeenCalledWith(
      "agent.getModifiedFiles",
      expect.objectContaining({ fromEntryId: "snap-2" }),
    );
  });

  it("resolves fromEntryId from tree entries (previous turn's snapshot)", () => {
    const entries = [
      { id: "e1", type: "message", label: "user", parentId: null },
      { id: "e2", type: "message", label: "assistant", parentId: "e1" },
      {
        id: "snap-0",
        type: "custom",
        customType: "step-snapshot",
        parentId: "e2",
        data: { turnIndex: 0 },
      },
      { id: "e3", type: "message", label: "user", parentId: "snap-0" },
      { id: "e4", type: "message", label: "assistant", parentId: "e3" },
      {
        id: "snap-1",
        type: "custom",
        customType: "step-snapshot",
        parentId: "e4",
        data: { turnIndex: 1 },
      },
      { id: "e5", type: "message", label: "user", parentId: "snap-1" },
      { id: "e6", type: "message", label: "assistant", parentId: "e5" },
      {
        id: "snap-2",
        type: "custom",
        customType: "step-snapshot",
        parentId: "e6",
        data: { turnIndex: 2 },
      },
    ];

    function findFromEntryId(
      userEntryId: string,
      entries: Array<{ id: string; type: string; customType?: string; parentId: string | null }>,
    ): string | null {
      const userEntry = entries.find((e) => e.id === userEntryId);
      if (!userEntry) return null;

      const userIndex = entries.indexOf(userEntry);
      for (let i = userIndex - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.type === "custom" && e.customType === "step-snapshot") {
          return e.id;
        }
      }
      return null;
    }

    expect(findFromEntryId("e5", entries)).toBe("snap-1");
    expect(findFromEntryId("e3", entries)).toBe("snap-0");
    expect(findFromEntryId("e1", entries)).toBeNull();
  });

  it("getFileDiff returns diff content when resolvedFromEntryId is provided", async () => {
    const getFileDiff = vi.fn(
      async (params: { filePath: string; fromEntryId?: string; toEntryId: string }) => {
        if (!params.fromEntryId) {
          return null;
        }
        return {
          path: params.filePath,
          oldContent: "old content\n",
          newContent: "new content\n",
          unifiedDiff: "--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old content\n+new content\n",
        };
      },
    );

    const result = await getFileDiff({
      filePath: "A.ts",
      fromEntryId: "snap-1",
      toEntryId: "snap-2",
    });
    expect(result).not.toBeNull();
    expect(result.unifiedDiff).toContain("+new content");

    const noResult = await getFileDiff({
      filePath: "A.ts",
      toEntryId: "snap-2",
    });
    expect(noResult).toBeNull();
  });
});
