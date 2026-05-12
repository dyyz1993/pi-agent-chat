import { describe, it, expect, beforeEach } from "vitest";
import { useRollbackStore } from "../src/mainview/stores/use-rollback-store";
import type { RollbackPreview, ModifiedFile } from "../src/mainview/stores/use-rollback-store";

const sampleFiles: ModifiedFile[] = [
  {
    path: "src/a.ts",
    status: "modified",
    turnIndex: 0,
    entryId: "e1",
    addedLines: 5,
    removedLines: 2,
  },
];

const samplePreview: RollbackPreview = {
  restored: ["src/a.ts"],
  deleted: [],
  files: sampleFiles,
  summary: { totalFiles: 1, added: 0, modified: 1, deleted: 0 },
};

describe("useRollbackStore", () => {
  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
  });

  it("has correct initial state", () => {
    const s = useRollbackStore.getState();
    expect(s.open).toBe(false);
    expect(s.target).toBeNull();
    expect(s.preview).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.selectedFilePath).toBeNull();
  });

  it("openRollback sets target, preview and open=true", () => {
    const target = { targetId: "t1", mode: "message" as const };
    useRollbackStore.getState().openRollback(target, samplePreview);

    const s = useRollbackStore.getState();
    expect(s.open).toBe(true);
    expect(s.target).toEqual(target);
    expect(s.preview).toEqual(samplePreview);
    expect(s.loading).toBe(false);
    expect(s.selectedFilePath).toBeNull();
  });

  it("closeRollback resets all state", () => {
    const target = { targetId: "t1", mode: "withFiles" as const };
    useRollbackStore.getState().openRollback(target, samplePreview);
    useRollbackStore.getState().setLoading(true);
    useRollbackStore.getState().setSelectedFilePath("x.ts");

    useRollbackStore.getState().closeRollback();

    const s = useRollbackStore.getState();
    expect(s.open).toBe(false);
    expect(s.target).toBeNull();
    expect(s.preview).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.selectedFilePath).toBeNull();
  });

  it("setLoading sets loading independently", () => {
    useRollbackStore.getState().setLoading(true);
    expect(useRollbackStore.getState().loading).toBe(true);

    useRollbackStore.getState().setLoading(false);
    expect(useRollbackStore.getState().loading).toBe(false);
  });

  it("setSelectedFilePath sets path independently", () => {
    useRollbackStore.getState().setSelectedFilePath("foo/bar.ts");
    expect(useRollbackStore.getState().selectedFilePath).toBe("foo/bar.ts");

    useRollbackStore.getState().setSelectedFilePath(null);
    expect(useRollbackStore.getState().selectedFilePath).toBeNull();
  });

  it("open → close → open preserves correct state", () => {
    const t1 = { targetId: "first", mode: "message" as const };
    const t2 = { targetId: "second", mode: "withFiles" as const };

    useRollbackStore.getState().openRollback(t1, samplePreview);
    useRollbackStore.getState().setLoading(true);
    useRollbackStore.getState().closeRollback();

    const preview2: RollbackPreview = {
      ...samplePreview,
      restored: [],
      deleted: ["src/a.ts"],
    };
    useRollbackStore.getState().openRollback(t2, preview2);

    const s = useRollbackStore.getState();
    expect(s.open).toBe(true);
    expect(s.target).toEqual(t2);
    expect(s.preview).toEqual(preview2);
    expect(s.loading).toBe(false);
    expect(s.selectedFilePath).toBeNull();
  });
});
