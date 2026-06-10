import { describe, it, expect, beforeEach } from "vitest";
import { useRollbackStore } from "../../../src/mainview/stores/use-rollback-store";
import type { ModifiedFile } from "../../../src/mainview/stores/use-rollback-store";

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

describe("rollback getModifiedFiles integration", () => {
  beforeEach(() => {
    useRollbackStore.getState().closeRollback();
  });

  it("transforms restored files into ModifiedFile[] with status=modified", () => {
    const result = transformModifiedFilesResponse(["src/a.ts", "src/b.ts"], []);
    expect(result.files).toHaveLength(2);
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
    expect(result.summary.modified).toBe(2);
    expect(result.summary.deleted).toBe(0);
    expect(result.summary.totalFiles).toBe(2);
  });

  it("transforms deleted files into ModifiedFile[] with status=deleted", () => {
    const result = transformModifiedFilesResponse([], ["old.ts"]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      path: "old.ts",
      status: "deleted",
      turnIndex: 0,
      entryId: "",
    });
    expect(result.summary.deleted).toBe(1);
  });

  it("transforms mixed restored and deleted files", () => {
    const result = transformModifiedFilesResponse(
      ["src/a.ts", "src/b.ts"],
      ["temp.ts", "old-log.ts"],
    );
    expect(result.files).toHaveLength(4);
    expect(result.files[0].status).toBe("modified");
    expect(result.files[1].status).toBe("modified");
    expect(result.files[2].status).toBe("deleted");
    expect(result.files[3].status).toBe("deleted");
    expect(result.summary).toEqual({
      totalFiles: 4,
      added: 0,
      modified: 2,
      deleted: 2,
    });
  });

  it("handles empty response (no files changed)", () => {
    const result = transformModifiedFilesResponse([], []);
    expect(result.files).toHaveLength(0);
    expect(result.summary).toEqual({
      totalFiles: 0,
      added: 0,
      modified: 0,
      deleted: 0,
    });
  });

  it("can open rollback overlay with transformed backend data", () => {
    const target = { targetId: "t1", mode: "withFiles" as const };
    const transformed = transformModifiedFilesResponse(["src/main.ts"], ["src/deleted.ts"]);

    useRollbackStore.getState().openRollback(target, transformed);

    const s = useRollbackStore.getState();
    expect(s.open).toBe(true);
    expect(s.target).toEqual(target);
    expect(s.preview?.files).toHaveLength(2);
    expect(s.preview?.summary.modified).toBe(1);
    expect(s.preview?.summary.deleted).toBe(1);
  });

  it("turnIndex is sequential across restored+deleted", () => {
    const result = transformModifiedFilesResponse(["a.ts", "b.ts"], ["c.ts"]);
    expect(result.files[0].turnIndex).toBe(0);
    expect(result.files[1].turnIndex).toBe(1);
    expect(result.files[2].turnIndex).toBe(2);
  });

  it("restored paths match original paths", () => {
    const result = transformModifiedFilesResponse(["x/y/z.ts"], []);
    expect(result.restored).toEqual(["x/y/z.ts"]);
    expect(result.deleted).toEqual([]);
  });
});
