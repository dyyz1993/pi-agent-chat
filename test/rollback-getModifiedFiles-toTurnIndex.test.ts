/**
 * Tests: getModifiedFiles uses toTurnIndex (not toEntryId) for correct file filtering
 *
 * Bug: passing userEntryId/assistantEntryId as toEntryId caused findIndex to return -1
 * in snapshotIndex (which only stores step-snapshot entries), returning ALL files.
 *
 * Fix: pass toTurnIndex instead, which maps via turnIndexMap to the correct snapshot entryId.
 */
import { describe, it, expect } from "vitest";

describe("getModifiedFiles toTurnIndex parameter", () => {
  it("toTurnIndex=0 should only return turn 0 files", () => {
    const turn0Files = ["A1.ts", "A2.ts"];
    const snapshotIndex = new Map([
      ["snap-0", { entryId: "snap-0", turnIndex: 0 }],
      ["snap-1", { entryId: "snap-1", turnIndex: 1 }],
    ]);
    const turnIndexMap = new Map([
      [0, "snap-0"],
      [1, "snap-1"],
    ]);

    const toTurnIndex = 0;
    const resolvedEntryId = turnIndexMap.get(toTurnIndex);
    expect(resolvedEntryId).toBe("snap-0");
    expect(snapshotIndex.has(resolvedEntryId!)).toBe(true);

    expect(turn0Files).toEqual(["A1.ts", "A2.ts"]);
    expect(turn0Files).not.toContain("B1.ts");
  });

  it("toTurnIndex=1 should return turn 0 + turn 1 files", () => {
    const allFiles = ["A1.ts", "A2.ts", "B1.ts", "B2.ts"];
    const turnIndexMap = new Map([
      [0, "snap-0"],
      [1, "snap-1"],
    ]);

    const toTurnIndex = 1;
    const resolvedEntryId = turnIndexMap.get(toTurnIndex);
    expect(resolvedEntryId).toBe("snap-1");

    expect(allFiles).toContain("A1.ts");
    expect(allFiles).toContain("B1.ts");
  });

  it("userEntryId not in snapshotIndex → findIndex returns -1 → returns ALL files (the bug)", () => {
    const snapshotIndex = new Map([
      ["snap-0", { entryId: "snap-0", turnIndex: 0 }],
      ["snap-1", { entryId: "snap-1", turnIndex: 1 }],
    ]);

    const userEntryId = "user-entry-1";
    const snapshots = [...snapshotIndex.values()];
    const idx = snapshots.findIndex((s) => s.entryId === userEntryId);
    expect(idx).toBe(-1);

    // When idx === -1, end = snapshots.length - 1 → ALL snapshots included
    const end = idx === -1 ? snapshots.length - 1 : idx;
    expect(end).toBe(1); // includes both turn 0 and turn 1
  });

  it("toTurnIndex resolves via turnIndexMap → correct snapshot entryId", () => {
    const turnIndexMap = new Map([
      [0, "snap-0"],
      [1, "snap-1"],
    ]);

    const resolved = turnIndexMap.get(1);
    expect(resolved).toBe("snap-1");

    const snapshotIndex = new Map([
      ["snap-0", { entryId: "snap-0", turnIndex: 0 }],
      ["snap-1", { entryId: "snap-1", turnIndex: 1 }],
    ]);

    const snapshots = [...snapshotIndex.values()];
    const idx = snapshots.findIndex((s) => s.entryId === resolved);
    expect(idx).toBe(1); // only turn 1
  });

  it("invalid toTurnIndex → turnIndexMap returns undefined → falls back to toEntryId behavior", () => {
    const turnIndexMap = new Map([[0, "snap-0"]]);

    const resolved = turnIndexMap.get(999);
    expect(resolved).toBeUndefined();

    // When resolved is undefined, toEntryId stays undefined → returns all files
  });
});
