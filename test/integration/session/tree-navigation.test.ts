/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  createLeafPointerEntry,
  mapJsonlEntriesToTreeEntries,
  parseJsonlTreeEntry,
  resolveFallbackBranchPoint,
  type JsonlTreeEntry,
} from "../../../src/shared/agent/session-tree-navigation";

function messageEntry(id: string, parentId: string | null, role: string): JsonlTreeEntry {
  return { id, parentId, type: "message", label: role };
}

describe("session tree navigation helpers", () => {
  it("parses JSONL tree entries and labels message roles/custom entries", () => {
    expect(
      parseJsonlTreeEntry({
        id: "m1",
        parentId: "root",
        type: "message",
        message: { role: "assistant" },
      }),
    ).toEqual({
      id: "m1",
      parentId: "root",
      type: "message",
      customType: undefined,
      label: "assistant",
    });

    expect(
      parseJsonlTreeEntry({
        id: "c1",
        parentId: "m1",
        type: "custom",
        customType: "bash",
      }),
    ).toEqual({
      id: "c1",
      parentId: "m1",
      type: "custom",
      customType: "bash",
      label: "bash",
    });

    expect(parseJsonlTreeEntry({ type: "message" })).toBeNull();
  });

  it("resolves assistant targets to the target entry itself", () => {
    const entries = [messageEntry("u1", null, "user"), messageEntry("a1", "u1", "assistant")];

    expect(resolveFallbackBranchPoint(entries, "a1")).toEqual({
      exists: true,
      branchPointId: "a1",
    });
  });

  it("resolves user targets to the nearest non-metadata ancestor", () => {
    const entries: JsonlTreeEntry[] = [
      messageEntry("u1", null, "user"),
      messageEntry("a1", "u1", "assistant"),
      { id: "meta1", parentId: "a1", type: "leaf_pointer" },
      { id: "meta2", parentId: "meta1", type: "label" },
      messageEntry("u2", "meta2", "user"),
    ];

    expect(resolveFallbackBranchPoint(entries, "u2")).toEqual({
      exists: true,
      branchPointId: "a1",
    });
  });

  it("reports missing targets without inventing a branch point", () => {
    expect(resolveFallbackBranchPoint([messageEntry("u1", null, "user")], "missing")).toEqual({
      exists: false,
      branchPointId: null,
    });
  });

  it("creates leaf pointer entries and maps JSONL entries to tree entries", () => {
    const leafPointer = JSON.parse(createLeafPointerEntry("a1")) as Record<string, unknown>;

    expect(leafPointer.type).toBe("leaf_pointer");
    expect(leafPointer.parentId).toBeNull();
    expect(leafPointer.leafId).toBe("a1");
    expect(typeof leafPointer.id).toBe("string");

    expect(
      mapJsonlEntriesToTreeEntries([
        { id: "u1", parentId: null, type: "message", label: "user", customType: undefined },
      ]),
    ).toEqual([{ id: "u1", parentId: null, type: "message", label: "user" }]);
  });
});
