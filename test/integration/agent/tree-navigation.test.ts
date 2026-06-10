/**
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

import {
  getTreeOperation,
  navigateTreeOperation,
  readJsonlTreeEntriesOperation,
} from "../../../src/shared/agent/agent-tree-navigation-operations";

function makeEntry(
  id: string,
  parentId: string | null,
  type: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id,
    parentId,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function makeMessage(id: string, parentId: string | null, role: string): string {
  return makeEntry(id, parentId, "message", {
    message: { role, content: [{ type: "text", text: "test" }] },
  });
}

describe("agent tree navigation operations", () => {
  it("blocks active client navigation while the agent is streaming", async () => {
    const navigateTree = vi.fn().mockResolvedValue({ cancelled: false });
    const leafIds = new Map<string, string | null>();

    await expect(
      navigateTreeOperation({
        sessionId: "sess-1",
        targetId: "target",
        getActiveManaged: () => ({
          info: { status: "streaming" },
          client: { navigateTree },
        }),
        resolveSessionPath: () => "",
        leafIds,
      }),
    ).resolves.toEqual({ cancelled: true, reason: "Agent is streaming" });

    expect(navigateTree).not.toHaveBeenCalled();
    expect(leafIds.has("sess-1")).toBe(false);
  });

  it("applies JSONL fallback navigation and persists a leaf pointer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tree-nav-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        makeEntry("root", null, "session"),
        makeMessage("m1", "root", "user"),
        makeMessage("m2", "m1", "assistant"),
      ].join("\n"),
      "utf-8",
    );
    const leafIds = new Map<string, string | null>();

    await expect(
      navigateTreeOperation({
        sessionId: "sess-1",
        targetId: "m2",
        navigateOptions: { skipFiles: true },
        getActiveManaged: () => null,
        resolveSessionPath: () => sessionPath,
        leafIds,
      }),
    ).resolves.toEqual({ cancelled: false });

    expect(leafIds.get("sess-1")).toBe("m2");
    const persisted = readFileSync(sessionPath, "utf-8");
    expect(persisted).toContain('"type":"leaf_pointer"');
    expect(persisted).toContain('"leafId":"m2"');
  });

  it("maps JSONL entries for getTree fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-tree-get-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        makeEntry("root", null, "session"),
        makeMessage("m1", "root", "user"),
        "not-json",
        makeMessage("m2", "m1", "assistant"),
      ].join("\n"),
      "utf-8",
    );
    const leafIds = new Map<string, string | null>([["sess-1", "m2"]]);

    await expect(
      getTreeOperation({
        sessionId: "sess-1",
        getActiveManaged: () => null,
        resolveSessionPath: () => sessionPath,
        leafIds,
        readJsonlEntries: readJsonlTreeEntriesOperation,
      }),
    ).resolves.toEqual({
      entries: [
        { id: "root", parentId: null, type: "session", label: undefined },
        { id: "m1", parentId: "root", type: "message", label: "user" },
        { id: "m2", parentId: "m1", type: "message", label: "assistant" },
      ],
      leafId: "m2",
    });
  });
});
