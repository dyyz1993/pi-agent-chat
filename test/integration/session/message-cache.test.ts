/**
 * @vitest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SessionMessageCache,
  type SessionCacheData,
  type SessionCustomEntry,
  type SessionMessageEntry,
} from "../../../src/shared/agent/session-message-cache";

let tempDirs: string[] = [];

function makeTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-session-cache-"));
  tempDirs.push(dir);
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function makeCacheData(overrides: Partial<SessionCacheData> = {}): SessionCacheData {
  return {
    messages: overrides.messages ?? [{ entryId: "m1", message: { role: "user" } }],
    customEntries: overrides.customEntries ?? [],
    compactionEntries: overrides.compactionEntries ?? [],
    parentById: overrides.parentById ?? new Map([["m1", null]]),
    lastJsonlLeafPointer: overrides.lastJsonlLeafPointer ?? null,
    activeJsonlLeafId: overrides.activeJsonlLeafId ?? "m1",
    lineCount: overrides.lineCount ?? 1,
  };
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("SessionMessageCache", () => {
  it("returns an exact cache hit when the session file is unchanged", () => {
    const filePath = makeTempFile(
      JSON.stringify({ type: "message", id: "m1", message: { role: "user" } }) + "\n",
    );
    const cache = new SessionMessageCache();
    cache.set("s1", filePath, makeCacheData());

    const hit = cache.get("s1", filePath);

    expect(hit?.needsIncremental).toBe(false);
    expect(hit?.messages).toHaveLength(1);
    expect(hit?.lineCount).toBe(1);
  });

  it("marks a cache hit as incremental when the session file grows", () => {
    const filePath = makeTempFile(
      JSON.stringify({ type: "message", id: "m1", message: { role: "user" } }) + "\n",
    );
    const cache = new SessionMessageCache();
    cache.set("s1", filePath, makeCacheData());

    writeFileSync(
      filePath,
      [
        JSON.stringify({ type: "message", id: "m1", message: { role: "user" } }),
        JSON.stringify({
          type: "message",
          id: "m2",
          parentId: "m1",
          message: { role: "assistant" },
        }),
        "",
      ].join("\n"),
      "utf-8",
    );

    const hit = cache.get("s1", filePath);

    expect(hit?.needsIncremental).toBe(true);
    expect(hit?.messages.map((m) => m.entryId)).toEqual(["m1"]);
  });

  it("invalidates the cache when the session file shrinks", () => {
    const filePath = makeTempFile(
      [
        JSON.stringify({ type: "message", id: "m1", message: { role: "user" } }),
        JSON.stringify({
          type: "message",
          id: "m2",
          parentId: "m1",
          message: { role: "assistant" },
        }),
        "",
      ].join("\n"),
    );
    const cache = new SessionMessageCache();
    cache.set("s1", filePath, makeCacheData({ lineCount: 2 }));

    writeFileSync(filePath, "", "utf-8");

    expect(cache.get("s1", filePath)).toBeNull();
  });

  it("evicts the oldest session when the cache reaches capacity", () => {
    const firstPath = makeTempFile(JSON.stringify({ type: "message", id: "m1" }) + "\n");
    const secondPath = makeTempFile(JSON.stringify({ type: "message", id: "m2" }) + "\n");
    const cache = new SessionMessageCache(1);

    cache.set("s1", firstPath, makeCacheData({ messages: [{ entryId: "m1", message: {} }] }));
    cache.set("s2", secondPath, makeCacheData({ messages: [{ entryId: "m2", message: {} }] }));

    expect(cache.get("s1", firstPath)).toBeNull();
    expect(cache.get("s2", secondPath)?.messages.map((m) => m.entryId)).toEqual(["m2"]);
  });

  it("reads JSONL entries after the requested physical line", async () => {
    const filePath = makeTempFile(
      [
        JSON.stringify({ type: "message", id: "m1", message: { role: "user" } }),
        "not-json",
        JSON.stringify({
          type: "custom",
          id: "c1",
          customType: "tool",
          data: { ok: true },
          timestamp: "2026-06-05T00:00:00.000Z",
        }),
        JSON.stringify({
          type: "message",
          id: "m2",
          parentId: "m1",
          message: { role: "assistant" },
        }),
        "",
      ].join("\n"),
    );
    const cache = new SessionMessageCache();
    const messages: SessionMessageEntry[] = [];
    const customEntries: SessionCustomEntry[] = [];
    const parentById = new Map<string, string | null>();

    const result = await cache.readJsonlFromLine(filePath, 1, messages, customEntries, parentById);

    expect(result).toEqual({ newEntries: 2, totalLines: 4 });
    expect(messages.map((m) => m.entryId)).toEqual(["m2"]);
    expect(customEntries.map((entry) => entry.id)).toEqual(["c1"]);
    expect(parentById.get("m2")).toBe("m1");
  });
});
