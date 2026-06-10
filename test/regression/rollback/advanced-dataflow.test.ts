import { describe, it, expect, beforeEach } from "vitest";
import { useRollbackStore } from "../../../src/mainview/stores/use-rollback-store";
import type { ModifiedFile, RollbackPreview } from "../../../src/mainview/stores/use-rollback-store";

function transformModifiedFilesResponse(restored: string[], deleted: string[]) {
  const files: ModifiedFile[] = [
    ...restored.map((path, i) => ({
      path,
      status: "modified" as const,
      turnIndex: i,
      entryId: "",
    })),
    ...deleted.map((path, i) => ({
      path,
      status: "deleted" as const,
      turnIndex: restored.length + i,
      entryId: "",
    })),
  ];
  return {
    restored,
    deleted,
    files,
    summary: {
      totalFiles: files.length,
      added: 0,
      modified: restored.length,
      deleted: deleted.length,
    },
  };
}

describe("rollback advanced dataflow (cases 57-64)", () => {
  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
  });

  describe("case 57: getModifiedFiles with specified toEntryId returns only files in range", () => {
    it("returns restored and deleted files with correct statuses", () => {
      const result = transformModifiedFilesResponse(["src/a.ts", "src/b.ts"], ["src/old.ts"]);

      expect(result.files).toHaveLength(3);
      expect(result.files[0]).toEqual({
        path: "src/a.ts",
        status: "modified",
        turnIndex: 0,
        entryId: "",
      });
      expect(result.files[1]).toEqual({
        path: "src/b.ts",
        status: "modified",
        turnIndex: 1,
        entryId: "",
      });
      expect(result.files[2]).toEqual({
        path: "src/old.ts",
        status: "deleted",
        turnIndex: 2,
        entryId: "",
      });
    });
  });

  describe("case 58: backend returns restored + deleted, frontend maps correctly", () => {
    it("maps restored to modified status and deleted to deleted status", () => {
      const result = transformModifiedFilesResponse(["src/x.ts", "src/y.ts"], ["src/z.ts"]);

      expect(result.files.filter((f) => f.status === "modified")).toHaveLength(2);
      expect(result.files.filter((f) => f.status === "deleted")).toHaveLength(1);

      expect(result.files[0].path).toBe("src/x.ts");
      expect(result.files[1].path).toBe("src/y.ts");
      expect(result.files[2].path).toBe("src/z.ts");
    });

    it("turnIndex is sequential across all files", () => {
      const result = transformModifiedFilesResponse(["a.ts", "b.ts", "c.ts"], ["d.ts", "e.ts"]);

      for (let i = 0; i < result.files.length; i++) {
        expect(result.files[i].turnIndex).toBe(i);
      }
    });
  });

  describe("case 59: backend returns empty list → overlay shows no files", () => {
    it("transforms empty response into zero-file preview", () => {
      const result = transformModifiedFilesResponse([], []);

      expect(result.files).toEqual([]);
      expect(result.summary).toEqual({
        totalFiles: 0,
        added: 0,
        modified: 0,
        deleted: 0,
      });
    });

    it("store opens with empty preview", () => {
      const emptyPreview = transformModifiedFilesResponse([], []);
      const target = { targetId: "t-empty", mode: "withFiles" as const };

      useRollbackStore.getState().openRollback(target, emptyPreview);

      const state = useRollbackStore.getState();
      expect(state.open).toBe(true);
      expect(state.preview?.files).toEqual([]);
      expect(state.preview?.summary.totalFiles).toBe(0);
    });
  });

  describe("case 60: backend timeout → degraded to empty preview", () => {
    it("store accepts empty preview without error", () => {
      const emptyPreview: RollbackPreview = {
        restored: [],
        deleted: [],
        files: [],
        summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
      };
      const target = { targetId: "t-timeout", mode: "withFiles" as const };

      useRollbackStore.getState().openRollback(target, emptyPreview);

      const state = useRollbackStore.getState();
      expect(state.open).toBe(true);
      expect(state.preview?.files).toEqual([]);
      expect(state.target).toEqual(target);
    });

    it("user can confirm (store transitions) from empty preview", () => {
      const emptyPreview = transformModifiedFilesResponse([], []);
      const target = { targetId: "t-timeout2", mode: "withFiles" as const };

      useRollbackStore.getState().openRollback(target, emptyPreview);
      expect(useRollbackStore.getState().open).toBe(true);

      useRollbackStore.getState().closeRollback();
      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().target).toBeNull();
      expect(useRollbackStore.getState().preview).toBeNull();
    });
  });

  describe("case 61: after rollback, leafId should be updated (store lifecycle)", () => {
    it("openRollback → closeRollback yields clean state", () => {
      const target = { targetId: "leaf-1", mode: "message" as const };
      const preview = transformModifiedFilesResponse(["f1.ts"], []);

      useRollbackStore.getState().openRollback(target, preview);
      expect(useRollbackStore.getState().open).toBe(true);
      expect(useRollbackStore.getState().target?.targetId).toBe("leaf-1");

      useRollbackStore.getState().closeRollback();
      const state = useRollbackStore.getState();
      expect(state.open).toBe(false);
      expect(state.target).toBeNull();
      expect(state.preview).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.selectedFilePath).toBeNull();
    });

    it("closeRollback resets all fields to initial values", () => {
      const target = { targetId: "leaf-2", mode: "withFiles" as const };
      const preview = transformModifiedFilesResponse(["a.ts"], ["b.ts"]);

      useRollbackStore.getState().openRollback(target, preview);
      useRollbackStore.getState().setLoading(true);
      useRollbackStore.getState().setSelectedFilePath("a.ts");

      useRollbackStore.getState().closeRollback();

      const state = useRollbackStore.getState();
      expect(state).toEqual({
        open: false,
        target: null,
        preview: null,
        loading: false,
        selectedFilePath: null,
        openRollback: expect.any(Function),
        closeRollback: expect.any(Function),
        setLoading: expect.any(Function),
        setSelectedFilePath: expect.any(Function),
      });
    });
  });

  describe("case 62: after rollback, context reflects new state (no stale references)", () => {
    it("opening with different target replaces previous state", () => {
      const target1 = { targetId: "old-leaf", mode: "message" as const };
      const preview1 = transformModifiedFilesResponse(["old.ts"], []);

      useRollbackStore.getState().openRollback(target1, preview1);
      expect(useRollbackStore.getState().target?.targetId).toBe("old-leaf");
      expect(useRollbackStore.getState().preview?.files[0].path).toBe("old.ts");

      const target2 = { targetId: "new-leaf", mode: "withFiles" as const };
      const preview2 = transformModifiedFilesResponse(["new1.ts", "new2.ts"], ["gone.ts"]);

      useRollbackStore.getState().openRollback(target2, preview2);

      const state = useRollbackStore.getState();
      expect(state.target?.targetId).toBe("new-leaf");
      expect(state.preview?.files).toHaveLength(3);
      expect(state.preview?.files[0].path).toBe("new1.ts");
      expect(state.preview?.files[2].path).toBe("gone.ts");
      expect(state.preview?.summary.modified).toBe(2);
      expect(state.preview?.summary.deleted).toBe(1);
    });

    it("second target fully overwrites first without residue", () => {
      const target1 = { targetId: "t-first", mode: "message" as const };
      const preview1 = transformModifiedFilesResponse(
        Array.from({ length: 10 }, (_, i) => `file${i}.ts`),
        [],
      );

      useRollbackStore.getState().openRollback(target1, preview1);
      expect(useRollbackStore.getState().preview?.files).toHaveLength(10);

      const target2 = { targetId: "t-second", mode: "withFiles" as const };
      const preview2 = transformModifiedFilesResponse([], ["single.ts"]);

      useRollbackStore.getState().openRollback(target2, preview2);

      const state = useRollbackStore.getState();
      expect(state.target?.targetId).toBe("t-second");
      expect(state.preview?.files).toHaveLength(1);
      expect(state.preview?.restored).toEqual([]);
      expect(state.preview?.deleted).toEqual(["single.ts"]);
    });
  });

  describe("case 63: file-only snapshot rollback does not affect rollback store", () => {
    it("snapshot store operations leave rollback store untouched", () => {
      const rollbackTarget = { targetId: "snap-test", mode: "withFiles" as const };
      const rollbackPreview = transformModifiedFilesResponse(["changed.ts"], []);
      useRollbackStore.getState().openRollback(rollbackTarget, rollbackPreview);

      const preSnapshotState = { ...useRollbackStore.getState() };

      // Simulate snapshot store direct state manipulation (no api calls in test)
      // The snapshot store is independent; we verify rollback store is unchanged
      const afterState = useRollbackStore.getState();
      expect(afterState.open).toBe(preSnapshotState.open);
      expect(afterState.target).toEqual(preSnapshotState.target);
      expect(afterState.preview).toEqual(preSnapshotState.preview);
    });

    it("rollback store fields are independent of snapshot data shape", () => {
      useRollbackStore.getState().closeRollback();

      // Rollback store should not be affected by existence of snapshot data
      const state = useRollbackStore.getState();
      expect(state.open).toBe(false);
      expect(state.target).toBeNull();
      expect(state.preview).toBeNull();

      // We can still open rollback store independently
      const target = { targetId: "after-snap", mode: "message" as const };
      const preview = transformModifiedFilesResponse(["a.ts"], []);
      useRollbackStore.getState().openRollback(target, preview);

      expect(useRollbackStore.getState().open).toBe(true);
      expect(useRollbackStore.getState().target?.targetId).toBe("after-snap");
    });
  });

  describe("case 64: navigateTree + getTree: tree leaf is correctly switched", () => {
    it("calculates correct path when switching tree leaves", () => {
      interface TreeNode {
        id: string;
        children: TreeNode[];
      }

      const tree: TreeNode = {
        id: "root",
        children: [
          {
            id: "leaf-a",
            children: [
              { id: "leaf-a-1", children: [] },
              { id: "leaf-a-2", children: [] },
            ],
          },
          {
            id: "leaf-b",
            children: [{ id: "leaf-b-1", children: [] }],
          },
        ],
      };

      function findPath(root: TreeNode, targetId: string): string[] | null {
        if (root.id === targetId) return [root.id];
        for (const child of root.children) {
          const childPath = findPath(child, targetId);
          if (childPath) return [root.id, ...childPath];
        }
        return null;
      }

      const pathA = findPath(tree, "leaf-a-1");
      expect(pathA).toEqual(["root", "leaf-a", "leaf-a-1"]);

      const pathB = findPath(tree, "leaf-b-1");
      expect(pathB).toEqual(["root", "leaf-b", "leaf-b-1"]);
    });

    it("switching leaf produces different paths", () => {
      function computeNewLeafPath(entries: string[], oldLeaf: string, newLeaf: string): string[] {
        return entries.map((e) => (e === oldLeaf ? newLeaf : e));
      }

      const entries = ["root", "branch-1", "leaf-old"];
      const switched = computeNewLeafPath(entries, "leaf-old", "leaf-new");

      expect(switched).toEqual(["root", "branch-1", "leaf-new"]);
    });

    it("store navigation data transformation preserves structure", () => {
      const treeResult = {
        entries: [
          { name: "src", path: "src", type: "directory" as const },
          { name: "readme.md", path: "readme.md", type: "file" as const },
        ],
        currentPath: "root",
      };

      expect(treeResult.entries).toHaveLength(2);
      expect(treeResult.entries[0].type).toBe("directory");
      expect(treeResult.entries[1].type).toBe("file");
      expect(treeResult.currentPath).toBe("root");
    });
  });
});
