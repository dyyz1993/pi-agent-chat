/**
 * @vitest-environment node
 */
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  appendUiJsonlEntriesFromPath,
  readFullJsonlAccumulator,
} from "../src/shared/agent/session-jsonl-messages";

describe("session jsonl message readers", () => {
  it("reads full message accumulator from local JSONL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-jsonl-reader-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user" } }),
        JSON.stringify({ type: "custom", id: "c1", parentId: "u1", customType: "note", data: {} }),
        JSON.stringify({ type: "leaf_pointer", id: "lp", leafId: "u1" }),
      ].join("\n"),
      "utf-8",
    );

    const accumulator = await readFullJsonlAccumulator({ sessionPath });

    expect(accumulator.allMessages).toHaveLength(1);
    expect(accumulator.allCustomEntries).toHaveLength(1);
    expect(accumulator.parentById.get("u1")).toBeNull();
    expect(accumulator.lastJsonlLeafPointer).toBe("u1");
  });

  it("reads UI entries through sandbox reader when sandbox path is used", async () => {
    const messages: unknown[] = [];
    const customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> =
      [];

    await appendUiJsonlEntriesFromPath({
      sessionPath: "/root/workspace/sessions/session.jsonl",
      messages,
      customEntries,
      activePathIds: null,
      includeMessages: true,
      readSandboxFile: async () =>
        [
          JSON.stringify({ type: "message", id: "u1", message: { role: "user" } }),
          JSON.stringify({ type: "custom", id: "c1", customType: "note", data: { ok: true } }),
        ].join("\n"),
    });

    expect(messages).toEqual([{ role: "user" }]);
    expect(customEntries).toMatchObject([{ id: "c1", customType: "note", data: { ok: true } }]);
  });
});
