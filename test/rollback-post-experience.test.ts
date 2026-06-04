import { describe, it, expect, beforeEach } from "vitest";
import { useRollbackStore } from "../src/mainview/stores/use-rollback-store";
import type { RollbackPreview, ModifiedFile } from "../src/mainview/stores/use-rollback-store";

const makeFiles = (count: number): ModifiedFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `src/file-${i}.ts`,
    status: (["added", "modified", "deleted"] as const)[i % 3],
    turnIndex: i,
    entryId: `e-${i}`,
    addedLines: i * 2,
    removedLines: i,
  }));

const makePreview = (overrides?: Partial<RollbackPreview>): RollbackPreview => {
  const files = makeFiles(3);
  return {
    restored: files.filter((f) => f.status !== "deleted").map((f) => f.path),
    deleted: files.filter((f) => f.status === "deleted").map((f) => f.path),
    files,
    summary: {
      totalFiles: files.length,
      added: files.filter((f) => f.status === "added").length,
      modified: files.filter((f) => f.status === "modified").length,
      deleted: files.filter((f) => f.status === "deleted").length,
    },
    ...overrides,
  };
};

const cleanState = () => {
  const s = useRollbackStore.getState();
  return {
    open: s.open,
    target: s.target,
    preview: s.preview,
    loading: s.loading,
    selectedFilePath: s.selectedFilePath,
  };
};

describe("rollback post-experience (cases 26-35)", () => {
  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
  });

  describe("Group A: message list correctness (26-28)", () => {
    it("26: open→close cycle leaves store ready for new data", () => {
      const target = { targetId: "msg-4", mode: "message" as const };
      const preview = makePreview();

      useRollbackStore.getState().openRollback(target, preview);
      expect(useRollbackStore.getState().open).toBe(true);

      useRollbackStore.getState().closeRollback();
      const after = cleanState();
      expect(after).toEqual({
        open: false,
        target: null,
        preview: null,
        loading: false,
        selectedFilePath: null,
      });

      const newPreview = makePreview({ restored: ["x.ts"], deleted: [] });
      newPreview.files = [];
      newPreview.summary = { totalFiles: 0, added: 0, modified: 0, deleted: 0 };
      useRollbackStore
        .getState()
        .openRollback({ targetId: "msg-1", mode: "withFiles" as const }, newPreview);
      expect(useRollbackStore.getState().preview).toEqual(newPreview);
      expect(useRollbackStore.getState().target!.targetId).toBe("msg-1");
    });

    it("27: full lifecycle open→setLoading(true)→closeRollback yields clean state", () => {
      const target = { targetId: "msg-7", mode: "withFiles" as const };
      const preview = makePreview();

      useRollbackStore.getState().openRollback(target, preview);
      useRollbackStore.getState().setLoading(true);
      expect(useRollbackStore.getState().loading).toBe(true);

      useRollbackStore.getState().closeRollback();

      const s = cleanState();
      expect(s.open).toBe(false);
      expect(s.loading).toBe(false);
      expect(s.target).toBeNull();
      expect(s.preview).toBeNull();
    });

    it("28: store only manages overlay state — preview data is not mutated", () => {
      const preview = makePreview();
      const originalRestored = [...preview.restored];
      const originalFiles = preview.files.map((f) => ({ ...f }));

      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "message" as const }, preview);
      useRollbackStore.getState().setLoading(true);
      useRollbackStore.getState().setSelectedFilePath("src/file-0.ts");
      useRollbackStore.getState().closeRollback();

      expect(preview.restored).toEqual(originalRestored);
      expect(preview.files).toEqual(originalFiles);
    });
  });

  describe("Group B: input state (29-30)", () => {
    it("29: rollback lifecycle does not interfere with concurrent store actions", () => {
      const target = { targetId: "msg-2", mode: "message" as const };
      const preview = makePreview();

      useRollbackStore.getState().openRollback(target, preview);
      useRollbackStore.getState().setSelectedFilePath("a.ts");
      useRollbackStore.getState().setLoading(true);

      expect(useRollbackStore.getState().selectedFilePath).toBe("a.ts");
      expect(useRollbackStore.getState().loading).toBe(true);

      useRollbackStore.getState().closeRollback();
      expect(cleanState()).toEqual({
        open: false,
        target: null,
        preview: null,
        loading: false,
        selectedFilePath: null,
      });
    });

    it("30: preview with empty data does not break the store", () => {
      const emptyPreview: RollbackPreview = {
        restored: [],
        deleted: [],
        files: [],
        summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 },
      };

      useRollbackStore
        .getState()
        .openRollback({ targetId: "t-empty", mode: "message" as const }, emptyPreview);

      const s = useRollbackStore.getState();
      expect(s.preview).toEqual(emptyPreview);
      expect(s.open).toBe(true);

      useRollbackStore.getState().closeRollback();
      expect(useRollbackStore.getState().preview).toBeNull();
    });
  });

  describe("Group C: session tree state (31-32)", () => {
    it("31: target entry is stored correctly", () => {
      const target = { targetId: "entry-42", mode: "withFiles" as const };
      useRollbackStore.getState().openRollback(target, makePreview());

      expect(useRollbackStore.getState().target).toEqual(target);
      expect(useRollbackStore.getState().target!.targetId).toBe("entry-42");
      expect(useRollbackStore.getState().target!.mode).toBe("withFiles");
    });

    it("32: sequential rollbacks replace previous target", () => {
      const targets = [
        { targetId: "first", mode: "message" as const },
        { targetId: "second", mode: "withFiles" as const },
        { targetId: "third", mode: "message" as const },
      ];

      for (const t of targets) {
        useRollbackStore.getState().openRollback(t, makePreview());
        expect(useRollbackStore.getState().target!.targetId).toBe(t.targetId);
        useRollbackStore.getState().closeRollback();
        expect(useRollbackStore.getState().target).toBeNull();
      }
    });
  });

  describe("Group D: UI state after rollback (33-35)", () => {
    it("33: after closeRollback, store is in clean state", () => {
      const preview = makePreview();
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" as const }, preview);
      useRollbackStore.getState().setLoading(true);
      useRollbackStore.getState().setSelectedFilePath("src/x.ts");

      useRollbackStore.getState().closeRollback();

      expect(cleanState()).toEqual({
        open: false,
        target: null,
        preview: null,
        loading: false,
        selectedFilePath: null,
      });
    });

    it("34: store is reusable immediately after closeRollback", () => {
      const t1 = { targetId: "first", mode: "message" as const };
      useRollbackStore.getState().openRollback(t1, makePreview());
      useRollbackStore.getState().closeRollback();

      const t2 = { targetId: "second", mode: "withFiles" as const };
      const p2 = makePreview({ restored: ["new.ts"], deleted: ["old.ts"] });
      useRollbackStore.getState().openRollback(t2, p2);

      const s = useRollbackStore.getState();
      expect(s.open).toBe(true);
      expect(s.target).toEqual(t2);
      expect(s.preview!.restored).toContain("new.ts");
      expect(s.loading).toBe(false);
    });

    it("35: three consecutive rollback cycles maintain correct state", () => {
      const cycles = [
        { target: { targetId: "c1", mode: "message" as const }, preview: makePreview() },
        {
          target: { targetId: "c2", mode: "withFiles" as const },
          preview: makePreview({
            restored: [],
            deleted: makeFiles(5).map((f) => f.path),
            files: makeFiles(5),
            summary: { totalFiles: 5, added: 0, modified: 0, deleted: 5 },
          }),
        },
        { target: { targetId: "c3", mode: "message" as const }, preview: makePreview() },
      ];

      for (const { target, preview } of cycles) {
        useRollbackStore.getState().openRollback(target, preview);
        expect(useRollbackStore.getState().open).toBe(true);
        expect(useRollbackStore.getState().target).toEqual(target);
        expect(useRollbackStore.getState().loading).toBe(false);

        useRollbackStore.getState().setLoading(true);
        expect(useRollbackStore.getState().loading).toBe(true);

        useRollbackStore.getState().closeRollback();
        expect(cleanState()).toEqual({
          open: false,
          target: null,
          preview: null,
          loading: false,
          selectedFilePath: null,
        });
      }
    });
  });

  describe("edge cases", () => {
    it("handles preview with large file lists", () => {
      const bigFiles = makeFiles(100);
      const bigPreview: RollbackPreview = {
        restored: bigFiles.map((f) => f.path),
        deleted: [],
        files: bigFiles,
        summary: { totalFiles: 100, added: 34, modified: 33, deleted: 33 },
      };

      useRollbackStore
        .getState()
        .openRollback({ targetId: "big", mode: "withFiles" as const }, bigPreview);

      expect(useRollbackStore.getState().preview!.files.length).toBe(100);
      expect(useRollbackStore.getState().preview!.summary.totalFiles).toBe(100);

      useRollbackStore.getState().setSelectedFilePath("src/file-50.ts");
      expect(useRollbackStore.getState().selectedFilePath).toBe("src/file-50.ts");

      useRollbackStore.getState().closeRollback();
      expect(cleanState()).toEqual({
        open: false,
        target: null,
        preview: null,
        loading: false,
        selectedFilePath: null,
      });
    });

    it("setLoading during closed state does not open the overlay", () => {
      expect(useRollbackStore.getState().open).toBe(false);
      useRollbackStore.getState().setLoading(true);
      expect(useRollbackStore.getState().open).toBe(false);
      expect(useRollbackStore.getState().loading).toBe(true);

      useRollbackStore.getState().closeRollback();
      expect(useRollbackStore.getState().loading).toBe(false);
    });
  });
});
