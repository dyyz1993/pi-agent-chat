/**
 * @vitest-environment node
 */
import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  appendUiJsonlEntriesFromPath,
  readFullJsonlAccumulator,
  readFullJsonlAccumulatorCached,
} from "../../../src/shared/agent/session-jsonl-messages";
import { SessionMessageCache } from "../../../src/shared/agent/session-message-cache";

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
    const customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];

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

  it("reuses parsed JSONL data and incrementally reads appended lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-jsonl-reader-cache-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user" } }),
        JSON.stringify({ type: "leaf_pointer", id: "lp1", leafId: "u1" }),
      ].join("\n") + "\n",
      "utf-8",
    );
    const cache = new SessionMessageCache();

    const first = await readFullJsonlAccumulatorCached({
      sessionId: "sess-1",
      sessionPath,
      getCache: (sessionId, path) => cache.get(sessionId, path),
      setCache: (sessionId, path, data) => cache.set(sessionId, path, data),
    });
    const second = await readFullJsonlAccumulatorCached({
      sessionId: "sess-1",
      sessionPath,
      getCache: (sessionId, path) => cache.get(sessionId, path),
      setCache: (sessionId, path, data) => cache.set(sessionId, path, data),
    });

    expect(first.allMessages).toHaveLength(1);
    expect(second.allMessages).toHaveLength(1);
    expect(second.lastJsonlLeafPointer).toBe("u1");

    appendFileSync(
      sessionPath,
      [
        JSON.stringify({
          type: "message",
          id: "a1",
          parentId: "u1",
          message: { role: "assistant" },
        }),
        JSON.stringify({ type: "leaf_pointer", id: "lp2", leafId: "a1" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const third = await readFullJsonlAccumulatorCached({
      sessionId: "sess-1",
      sessionPath,
      getCache: (sessionId, path) => cache.get(sessionId, path),
      setCache: (sessionId, path, data) => cache.set(sessionId, path, data),
    });

    expect(third.allMessages.map((m) => m.entryId)).toEqual(["u1", "a1"]);
    expect(third.parentById.get("a1")).toBe("u1");
    expect(third.lastJsonlLeafPointer).toBe("a1");
  });
});
