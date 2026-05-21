import { describe, it, expect, beforeEach } from "vitest";
import { useRollbackStore } from "../src/mainview/stores/use-rollback-store";
import type { ModifiedFile, RollbackPreview } from "../src/mainview/stores/use-rollback-store";

function makePreview(overrides?: Partial<RollbackPreview>): RollbackPreview {
  return {
    restored: ["src/a.ts"],
    deleted: ["src/old.ts"],
    files: [
      {
        path: "src/a.ts",
        status: "modified",
        turnIndex: 0,
        entryId: "entry-1",
        addedLines: 10,
        removedLines: 2,
      },
      {
        path: "src/old.ts",
        status: "deleted",
        turnIndex: 1,
        entryId: "entry-2",
        addedLines: 0,
        removedLines: 50,
      },
    ],
    summary: { totalFiles: 2, added: 0, modified: 1, deleted: 1 },
    ...overrides,
  };
}

describe("rollback fork+compaction interaction (cases 65-68)", () => {
  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
  });

  describe("case 65: fork then rollback in new branch does not affect original", () => {
    it("sequential rollbacks produce independent state", () => {
      const previewA = makePreview({ restored: ["src/branch-a.ts"] });
      const previewB = makePreview({ restored: ["src/branch-b.ts"] });

      useRollbackStore.getState().openRollback({ targetId: "branch-A", mode: "message" }, previewA);
      expect(useRollbackStore.getState().target?.targetId).toBe("branch-A");
      expect(useRollbackStore.getState().preview?.restored).toEqual(["src/branch-a.ts"]);

      useRollbackStore.getState().closeRollback();
      const stateAfterFirstClose = useRollbackStore.getState();
      expect(stateAfterFirstClose.open).toBe(false);
      expect(stateAfterFirstClose.target).toBeNull();
      expect(stateAfterFirstClose.preview).toBeNull();
      expect(stateAfterFirstClose.loading).toBe(false);

      useRollbackStore
        .getState()
        .openRollback({ targetId: "branch-B", mode: "withFiles" }, previewB);
      const stateSecondOpen = useRollbackStore.getState();
      expect(stateSecondOpen.open).toBe(true);
      expect(stateSecondOpen.target?.targetId).toBe("branch-B");
      expect(stateSecondOpen.target?.mode).toBe("withFiles");
      expect(stateSecondOpen.preview?.restored).toEqual(["src/branch-b.ts"]);
      expect(stateSecondOpen.preview?.restored).not.toContain("src/branch-a.ts");
    });

    it("loading state from first rollback does not leak into second", () => {
      const preview = makePreview();

      useRollbackStore.getState().openRollback({ targetId: "branch-A", mode: "message" }, preview);
      useRollbackStore.getState().setLoading(true);
      expect(useRollbackStore.getState().loading).toBe(true);

      useRollbackStore.getState().closeRollback();
      useRollbackStore.getState().openRollback({ targetId: "branch-B", mode: "message" }, preview);
      expect(useRollbackStore.getState().loading).toBe(false);
    });

    it("selectedFilePath from first rollback does not leak into second", () => {
      const preview = makePreview();

      useRollbackStore
        .getState()
        .openRollback({ targetId: "branch-A", mode: "withFiles" }, preview);
      useRollbackStore.getState().setSelectedFilePath("src/branch-a.ts");
      expect(useRollbackStore.getState().selectedFilePath).toBe("src/branch-a.ts");

      useRollbackStore.getState().closeRollback();
      useRollbackStore
        .getState()
        .openRollback({ targetId: "branch-B", mode: "withFiles" }, preview);
      expect(useRollbackStore.getState().selectedFilePath).toBeNull();
    });
  });

  describe("case 66: fork dialog entry matches rollback target", () => {
    it("targetId in store matches the entry user selected in fork dialog", () => {
      const selectedEntryId = "entry-msg-0042";
      const preview = makePreview();

      useRollbackStore
        .getState()
        .openRollback({ targetId: selectedEntryId, mode: "message" }, preview);

      const { target } = useRollbackStore.getState();
      expect(target).not.toBeNull();
      expect(target!.targetId).toBe(selectedEntryId);
    });

    it("mode is preserved exactly as passed from fork dialog", () => {
      const preview = makePreview();

      useRollbackStore.getState().openRollback({ targetId: "entry-x", mode: "withFiles" }, preview);
      expect(useRollbackStore.getState().target?.mode).toBe("withFiles");

      useRollbackStore.getState().closeRollback();

      useRollbackStore.getState().openRollback({ targetId: "entry-y", mode: "message" }, preview);
      expect(useRollbackStore.getState().target?.mode).toBe("message");
    });

    it("different entry IDs produce distinct targets across sequential openings", () => {
      const preview = makePreview();
      const ids = ["entry-001", "entry-002", "entry-003"];

      for (const id of ids) {
        useRollbackStore.getState().openRollback({ targetId: id, mode: "message" }, preview);
        expect(useRollbackStore.getState().target?.targetId).toBe(id);
        useRollbackStore.getState().closeRollback();
        expect(useRollbackStore.getState().target).toBeNull();
      }
    });
  });

  describe("case 67: compaction then rollback - compaction summary is correctly removed", () => {
    it("full cleanup after openRollback + closeRollback cycle", () => {
      const preview = makePreview({
        restored: ["src/compacted-a.ts", "src/compacted-b.ts"],
        deleted: ["src/removed.ts"],
        summary: { totalFiles: 3, added: 0, modified: 2, deleted: 1 },
      });

      useRollbackStore
        .getState()
        .openRollback({ targetId: "compaction-entry", mode: "withFiles" }, preview);
      useRollbackStore.getState().setLoading(true);
      useRollbackStore.getState().setSelectedFilePath("src/compacted-a.ts");

      useRollbackStore.getState().closeRollback();

      const state = useRollbackStore.getState();
      expect(state.loading).toBe(false);
      expect(state.open).toBe(false);
      expect(state.target).toBeNull();
      expect(state.preview).toBeNull();
      expect(state.selectedFilePath).toBeNull();
    });

    it("no compaction preview data leaks after close", () => {
      const compactionPreview: RollbackPreview = {
        restored: [],
        deleted: ["src/legacy-a.ts", "src/legacy-b.ts", "src/legacy-c.ts"],
        files: [
          { path: "src/legacy-a.ts", status: "deleted", turnIndex: 0, entryId: "c1" },
          { path: "src/legacy-b.ts", status: "deleted", turnIndex: 1, entryId: "c2" },
          { path: "src/legacy-c.ts", status: "deleted", turnIndex: 2, entryId: "c3" },
        ],
        summary: { totalFiles: 3, added: 0, modified: 0, deleted: 3 },
      };

      useRollbackStore
        .getState()
        .openRollback({ targetId: "compact-01", mode: "withFiles" }, compactionPreview);
      expect(useRollbackStore.getState().preview?.files).toHaveLength(3);

      useRollbackStore.getState().closeRollback();
      expect(useRollbackStore.getState().preview).toBeNull();

      const freshPreview = makePreview({ restored: ["src/new.ts"] });
      useRollbackStore
        .getState()
        .openRollback({ targetId: "fresh-01", mode: "message" }, freshPreview);
      expect(useRollbackStore.getState().preview?.deleted).not.toContain("src/legacy-a.ts");
      expect(useRollbackStore.getState().preview?.restored).toEqual(["src/new.ts"]);
    });

    it("repeated open/close cycles do not accumulate state", () => {
      for (let i = 0; i < 5; i++) {
        const preview = makePreview({
          restored: [`src/file-${i}.ts`],
          deleted: [`src/old-${i}.ts`],
          summary: { totalFiles: 2, added: 0, modified: 1, deleted: 1 },
        });

        useRollbackStore
          .getState()
          .openRollback({ targetId: `cycle-${i}`, mode: "message" }, preview);
        useRollbackStore.getState().setLoading(true);
        useRollbackStore.getState().setSelectedFilePath(`src/file-${i}.ts`);
        useRollbackStore.getState().closeRollback();
      }

      const state = useRollbackStore.getState();
      expect(state.open).toBe(false);
      expect(state.target).toBeNull();
      expect(state.preview).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.selectedFilePath).toBeNull();
    });
  });

  describe("case 68: compaction doesn't lose SnapshotBadge data", () => {
    it("preview with detailed file diff data is preserved intact", () => {
      const snapshotPreview: RollbackPreview = {
        restored: ["src/app.tsx", "src/hooks.ts"],
        deleted: ["src/deprecated.ts"],
        files: [
          {
            path: "src/app.tsx",
            status: "modified" as const,
            turnIndex: 0,
            entryId: "snap-1",
            details: "Updated component imports",
            addedLines: 15,
            removedLines: 8,
          },
          {
            path: "src/hooks.ts",
            status: "modified" as const,
            turnIndex: 1,
            entryId: "snap-2",
            details: "Refactored hook signature",
            addedLines: 3,
            removedLines: 1,
          },
          {
            path: "src/deprecated.ts",
            status: "deleted" as const,
            turnIndex: 2,
            entryId: "snap-3",
            details: "Removed deprecated module",
            addedLines: 0,
            removedLines: 120,
          },
        ],
        summary: { totalFiles: 3, added: 0, modified: 2, deleted: 1 },
      };

      useRollbackStore
        .getState()
        .openRollback({ targetId: "snapshot-entry", mode: "withFiles" }, snapshotPreview);

      const { preview } = useRollbackStore.getState();
      expect(preview).not.toBeNull();
      expect(preview!.files).toHaveLength(3);

      const appFile = preview!.files.find((f) => f.path === "src/app.tsx");
      expect(appFile).toBeDefined();
      expect(appFile!.addedLines).toBe(15);
      expect(appFile!.removedLines).toBe(8);
      expect(appFile!.details).toBe("Updated component imports");
      expect(appFile!.status).toBe("modified");

      const hooksFile = preview!.files.find((f) => f.path === "src/hooks.ts");
      expect(hooksFile).toBeDefined();
      expect(hooksFile!.addedLines).toBe(3);
      expect(hooksFile!.removedLines).toBe(1);

      const deprecatedFile = preview!.files.find((f) => f.path === "src/deprecated.ts");
      expect(deprecatedFile).toBeDefined();
      expect(deprecatedFile!.addedLines).toBe(0);
      expect(deprecatedFile!.removedLines).toBe(120);
      expect(deprecatedFile!.status).toBe("deleted");
    });

    it("selectedFilePath can reference a snapshot file with full diff data", () => {
      const files: ModifiedFile[] = [
        {
          path: "src/snapshot-detailed.ts",
          status: "modified",
          turnIndex: 0,
          entryId: "snap-detail-1",
          details: "Complex refactoring with nested changes",
          addedLines: 42,
          removedLines: 19,
        },
      ];
      const preview: RollbackPreview = {
        restored: ["src/snapshot-detailed.ts"],
        deleted: [],
        files,
        summary: { totalFiles: 1, added: 0, modified: 1, deleted: 0 },
      };

      useRollbackStore
        .getState()
        .openRollback({ targetId: "snap-target", mode: "withFiles" }, preview);

      useRollbackStore.getState().setSelectedFilePath("src/snapshot-detailed.ts");
      expect(useRollbackStore.getState().selectedFilePath).toBe("src/snapshot-detailed.ts");

      const file = useRollbackStore.getState().preview?.files[0];
      expect(file?.addedLines).toBe(42);
      expect(file?.removedLines).toBe(19);
      expect(file?.details).toBe("Complex refactoring with nested changes");
    });

    it("snapshot summary totals are preserved accurately", () => {
      const snapshotPreview: RollbackPreview = {
        restored: ["src/a.ts", "src/b.ts", "src/c.ts"],
        deleted: ["src/d.ts", "src/e.ts"],
        files: [
          { path: "src/a.ts", status: "added", turnIndex: 0, entryId: "s1" },
          { path: "src/b.ts", status: "modified", turnIndex: 1, entryId: "s2" },
          { path: "src/c.ts", status: "modified", turnIndex: 2, entryId: "s3" },
          { path: "src/d.ts", status: "deleted", turnIndex: 3, entryId: "s4" },
          { path: "src/e.ts", status: "deleted", turnIndex: 4, entryId: "s5" },
        ],
        summary: { totalFiles: 5, added: 1, modified: 2, deleted: 2 },
      };

      useRollbackStore
        .getState()
        .openRollback({ targetId: "summary-test", mode: "withFiles" }, snapshotPreview);

      const { preview } = useRollbackStore.getState();
      expect(preview!.summary.totalFiles).toBe(5);
      expect(preview!.summary.added).toBe(1);
      expect(preview!.summary.modified).toBe(2);
      expect(preview!.summary.deleted).toBe(2);
      expect(preview!.files).toHaveLength(5);

      const addedFiles = preview!.files.filter((f) => f.status === "added");
      const modifiedFiles = preview!.files.filter((f) => f.status === "modified");
      const deletedFiles = preview!.files.filter((f) => f.status === "deleted");
      expect(addedFiles).toHaveLength(1);
      expect(modifiedFiles).toHaveLength(2);
      expect(deletedFiles).toHaveLength(2);
    });
  });
});
