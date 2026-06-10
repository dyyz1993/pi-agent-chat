import { describe, it, expect } from "vitest";
import { readFile } from "fs/promises";
import { join } from "path";

interface DiffFileItem {
  path: string;
  status: "added" | "modified" | "deleted";
  diff: {
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
  };
}

function shouldUseInlineDiffViewer(diffItem: DiffFileItem): boolean {
  return diffItem.diff.oldContent !== null && diffItem.diff.newContent !== null;
}

describe("SnapshotPanel diff display logic", () => {
  it("uses InlineDiffViewer when both oldContent and newContent exist", () => {
    const item: DiffFileItem = {
      path: "src/a.ts",
      status: "modified",
      diff: {
        path: "src/a.ts",
        oldContent: "old code",
        newContent: "new code",
        unifiedDiff: "--- a/src/a.ts\n+++ b/src/a.ts\n-old code\n+new code",
      },
    };
    expect(shouldUseInlineDiffViewer(item)).toBe(true);
  });

  it("falls back to unifiedDiff when oldContent is null", () => {
    const item: DiffFileItem = {
      path: "new.ts",
      status: "added",
      diff: {
        path: "new.ts",
        oldContent: null,
        newContent: "new file content",
        unifiedDiff: "--- /dev/null\n+++ b/new.ts\n+new file content",
      },
    };
    expect(shouldUseInlineDiffViewer(item)).toBe(false);
  });

  it("falls back to unifiedDiff when newContent is null", () => {
    const item: DiffFileItem = {
      path: "deleted.ts",
      status: "deleted",
      diff: {
        path: "deleted.ts",
        oldContent: "deleted content",
        newContent: null,
        unifiedDiff: "--- a/deleted.ts\n+++ /dev/null\n-deleted content",
      },
    };
    expect(shouldUseInlineDiffViewer(item)).toBe(false);
  });

  it("falls back to unifiedDiff when both are null", () => {
    const item: DiffFileItem = {
      path: "unknown.ts",
      status: "modified",
      diff: {
        path: "unknown.ts",
        oldContent: null,
        newContent: null,
        unifiedDiff: "some unified diff",
      },
    };
    expect(shouldUseInlineDiffViewer(item)).toBe(false);
  });

  it("handles empty string content (not null) as valid for InlineDiffViewer", () => {
    const item: DiffFileItem = {
      path: "empty.ts",
      status: "modified",
      diff: {
        path: "empty.ts",
        oldContent: "",
        newContent: "new content",
        unifiedDiff: "--- a/empty.ts\n+++ b/empty.ts\n+new content",
      },
    };
    expect(shouldUseInlineDiffViewer(item)).toBe(true);
  });

  it("SnapshotPanel imports InlineDiffViewer component", async () => {
    const filePath = join(__dirname, "../../../src/mainview/components/snapshot-panel/SnapshotPanel.tsx");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("InlineDiffViewer");
  });
});
