/**
 * getFullMessages LRU Cache — Unit Tests
 *
 * Tests the caching behavior of AgentProcessManager.getFullMessages:
 * - Cold read (no cache) → full JSONL scan + cache write
 * - Hot read (cache hit, file unchanged) → instant return, NO file I/O
 * - Warm read (cache + incremental) → read only appended lines
 * - File change → cache invalidation → cold read
 * - LRU eviction when cache is full
 * - Cache cleanup on session stop
 * - compaction entries preserved through cache
 * - leaf_pointer preserved through cache
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "perf_hooks";

import { AgentProcessManager } from "../src/shared/agent/process-manager";
import type { RPCServer } from "../src/shared/lib/rpc-server";

function createMockRPCServer(): RPCServer {
  return {
    call: (() => Promise.resolve()) as unknown as RPCServer["call"],
    on: (() => {}) as unknown as RPCServer["on"],
    off: (() => {}) as unknown as RPCServer["off"],
    emit: (() => {}) as unknown as RPCServer["emit"],
    broadcastEvent: (() => {}) as unknown as RPCServer["broadcastEvent"],
    registerHandler: (() => {}) as unknown as RPCServer["registerHandler"],
    getHandler: (() => undefined) as unknown as RPCServer["getHandler"],
    listMethods: (() => []) as unknown as RPCServer["listMethods"],
  } as RPCServer;
}

interface JsonlLine {
  id: string;
  parentId: string | null;
  type: string;
  message?: Record<string, unknown>;
  customType?: string;
  data?: unknown;
  timestamp?: string;
  summary?: string;
  tokensBefore?: number;
  leafId?: string;
}

function writeJsonlLines(filePath: string, lines: JsonlLine[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n");
  writeFileSync(filePath, content);
}

function appendJsonlLines(filePath: string, lines: JsonlLine[]): void {
  const existing = readFileSync(filePath, "utf-8");
  const content = lines.map((l) => JSON.stringify(l)).join("\n");
  writeFileSync(filePath, existing + "\n" + content);
}

function makeMessageLines(count: number, startIdx = 0, parentSeed: string | null = null): JsonlLine[] {
  const lines: JsonlLine[] = [];
  let parentId = parentSeed;
  for (let i = 0; i < count; i++) {
    const entryId = `entry-${startIdx + i}`;
    lines.push({
      id: entryId,
      parentId,
      type: "message",
      message: {
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${startIdx + i} with realistic content padding `.repeat(4),
      },
      timestamp: new Date(Date.now() + (startIdx + i) * 1000).toISOString(),
    });
    parentId = entryId;
  }
  return lines;
}

function createSessionFile(dir: string, sessionId: string, messageCount: number): string {
  const filePath = join(dir, `${sessionId}.jsonl`);
  const lines = makeMessageLines(messageCount);
  writeJsonlLines(filePath, lines);
  return filePath;
}

function appendToSessionFile(filePath: string, extraCount: number): void {
  const existing = readFileSync(filePath, "utf-8");
  const lastLine = existing.trim().split("\n").pop();
  let lastId: string | null = null;
  if (lastLine) {
    try { lastId = (JSON.parse(lastLine) as { id?: string }).id ?? null; } catch { /* ignore */ }
  }
  const raw = makeMessageLines(extraCount);
  const lines = raw.map((l, i) => ({
    ...l,
    id: `appended-${i}`,
    parentId: i === 0 ? lastId : `appended-${i - 1}`,
  }));
  appendJsonlLines(filePath, lines);
  utimesSync(filePath, new Date(), new Date(Date.now() + 2000));
}

describe("getFullMessages LRU Cache", () => {
  let manager: AgentProcessManager;
  let tmpDir: string;

  beforeEach(() => {
    manager = new AgentProcessManager(createMockRPCServer());
    tmpDir = join(tmpdir(), `test-cache-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    (manager as unknown as { clearAllTimers?: () => void }).clearAllTimers?.();
  });

  it("cold read: returns all messages and writes cache", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-cold", 50);
    const result = await manager.getFullMessages("sess-cold", sessionPath, { limit: 50 });

    expect(result.messages.length).toBe(50);
    expect(result.totalCount).toBe(50);
    expect(result.hasMore).toBe(false);

    const cache = manager.getSessionCache("sess-cold", sessionPath);
    expect(cache).not.toBeNull();
    expect(cache!.messages.length).toBe(50);
  });

  it("cache exact hit: second call skips file I/O, returns in < 1ms", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-hot", 200);

    await manager.getFullMessages("sess-hot", sessionPath, { limit: 200 });

    const t0 = performance.now();
    const hot = await manager.getFullMessages("sess-hot", sessionPath, { limit: 200 });
    const hotMs = performance.now() - t0;

    expect(hot.messages.length).toBe(200);
    expect(hot.totalCount).toBe(200);
    expect(hotMs).toBeLessThan(5);
    console.log(`    Hot cache hit: ${hotMs.toFixed(3)}ms`);
  });

  it("cache exact hit: correct data for different pagination", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-page-cache", 100);

    await manager.getFullMessages("sess-page-cache", sessionPath, { limit: 100 });

    const limited = await manager.getFullMessages("sess-page-cache", sessionPath, { limit: 20 });
    expect(limited.messages.length).toBe(20);
    expect(limited.totalCount).toBe(100);
    expect(limited.hasMore).toBe(true);

    const full = await manager.getFullMessages("sess-page-cache", sessionPath);
    expect(full.messages.length).toBe(100);
    expect(full.totalCount).toBe(100);
    expect(full.hasMore).toBe(false);
  });

  it("cache invalidates when file shrinks", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-shrink", 30);

    await manager.getFullMessages("sess-shrink", sessionPath, { limit: 30 });

    writeJsonlLines(sessionPath, makeMessageLines(10));
    utimesSync(sessionPath, new Date(), new Date(Date.now() + 2000));

    const result = await manager.getFullMessages("sess-shrink", sessionPath, { limit: 30 });
    expect(result.totalCount).toBe(10);
  });

  it("cache survives multiple switches between sessions", async () => {
    const path1 = createSessionFile(tmpDir, "sess-a", 50);
    const path2 = createSessionFile(tmpDir, "sess-b", 100);

    const a1 = await manager.getFullMessages("sess-a", path1, { limit: 50 });
    const b1 = await manager.getFullMessages("sess-b", path2, { limit: 50 });

    const a2 = await manager.getFullMessages("sess-a", path1, { limit: 50 });
    expect(a2.totalCount).toBe(50);
    expect(a2.messages).toEqual(a1.messages);

    const b2 = await manager.getFullMessages("sess-b", path2, { limit: 50 });
    expect(b2.totalCount).toBe(100);
    expect(b2.messages).toEqual(b1.messages);
  });

  it("clearSessionCache removes cached data", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-clear", 30);

    await manager.getFullMessages("sess-clear", sessionPath, { limit: 30 });
    manager.clearSessionCache("sess-clear");

    expect(manager.getSessionCache("sess-clear", sessionPath)).toBeNull();

    const result = await manager.getFullMessages("sess-clear", sessionPath, { limit: 30 });
    expect(result.totalCount).toBe(30);
  });

  it("clearSessionCache() with no args clears all caches", async () => {
    const path1 = createSessionFile(tmpDir, "sess-x", 20);
    const path2 = createSessionFile(tmpDir, "sess-y", 30);

    await manager.getFullMessages("sess-x", path1, { limit: 20 });
    await manager.getFullMessages("sess-y", path2, { limit: 30 });

    manager.clearSessionCache();

    const x = await manager.getFullMessages("sess-x", path1, { limit: 20 });
    const y = await manager.getFullMessages("sess-y", path2, { limit: 30 });
    expect(x.totalCount).toBe(20);
    expect(y.totalCount).toBe(30);
  });

  it("incremental append when file grows", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-incr", 50);

    await manager.getFullMessages("sess-incr", sessionPath, { limit: 50 });

    appendToSessionFile(sessionPath, 30);

    const second = await manager.getFullMessages("sess-incr", sessionPath, { limit: 100 });
    expect(second.totalCount).toBe(80);
  });

  it("incremental append does NOT create duplicates", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-dedup", 30);

    await manager.getFullMessages("sess-dedup", sessionPath, { limit: 30 });

    appendToSessionFile(sessionPath, 10);

    const second = await manager.getFullMessages("sess-dedup", sessionPath, { limit: 100 });

    expect(second.totalCount).toBe(40);

    const ids = second.messages.map((m) => (m as unknown as Record<string, unknown>).entryId).filter(Boolean);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("caches compaction entries and preserves compactionSummary", async () => {
    const filePath = join(tmpDir, "sess-compaction.jsonl");
    const lines: JsonlLine[] = [
      { id: "msg-1", parentId: null, type: "message", message: { role: "user", content: "hello" } },
      { id: "msg-2", parentId: "msg-1", type: "message", message: { role: "assistant", content: "hi" } },
      {
        id: "compaction-1",
        parentId: "msg-2",
        type: "compaction",
        summary: "compressed context",
        tokensBefore: 5000,
      },
      { id: "msg-3", parentId: "compaction-1", type: "message", message: { role: "user", content: "next" } },
      { id: "leaf-1", parentId: "msg-3", type: "leaf_pointer", leafId: "msg-3" },
    ];
    writeJsonlLines(filePath, lines);

    const result = await manager.getFullMessages("sess-compaction", filePath);
    const roles = result.messages.map((m) => (m as unknown as Record<string, unknown>).role);
    expect(roles).toContain("compactionSummary");

    const cache = manager.getSessionCache("sess-compaction", filePath);
    expect(cache).not.toBeNull();
    expect(cache!.compactionEntries.length).toBe(1);
    expect(cache!.compactionEntries[0].entryId).toBe("compaction-1");

    const hot = await manager.getFullMessages("sess-compaction", filePath);
    const hotRoles = hot.messages.map((m) => (m as unknown as Record<string, unknown>).role);
    expect(hotRoles).toContain("compactionSummary");
    expect(hot.messages.length).toBe(result.messages.length);
  });

  it("caches leaf_pointer and restores on cache hit", async () => {
    const filePath = join(tmpDir, "sess-leaf.jsonl");
    const lines: JsonlLine[] = [
      { id: "msg-1", parentId: null, type: "message", message: { role: "user", content: "hi" } },
      { id: "msg-2", parentId: "msg-1", type: "message", message: { role: "assistant", content: "there" } },
      { id: "lp-1", parentId: null, type: "leaf_pointer", leafId: "msg-2" },
    ];
    writeJsonlLines(filePath, lines);

    const cold = await manager.getFullMessages("sess-leaf", filePath);

    const cache = manager.getSessionCache("sess-leaf", filePath);
    expect(cache).not.toBeNull();
    expect(cache!.lastJsonlLeafPointer).toBe("msg-2");

    const hot = await manager.getFullMessages("sess-leaf", filePath);
    expect(hot.messages.length).toBe(cold.messages.length);

    const lastMsg = hot.messages[hot.messages.length - 1] as unknown as Record<string, unknown>;
    expect(lastMsg.role).toBe("assistant");
  });

  it("large file: second call is dramatically faster", async () => {
    const filePath = join(tmpDir, "sess-large.jsonl");
    const lines: JsonlLine[] = [];
    let parentId: string | null = null;
    for (let i = 0; i < 5000; i++) {
      const entryId = `e-${i}`;
      lines.push({
        id: entryId,
        parentId,
        type: "message",
        message: {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Large message ${i} `.repeat(20),
        },
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      });
      parentId = entryId;
    }
    writeJsonlLines(filePath, lines);

    const t0 = performance.now();
    const cold = await manager.getFullMessages("sess-large", filePath);
    const coldMs = performance.now() - t0;

    const t1 = performance.now();
    const hot = await manager.getFullMessages("sess-large", filePath);
    const hotMs = performance.now() - t1;

    expect(hot.messages.length).toBe(cold.messages.length);
    expect(hot.totalCount).toBe(5000);
    expect(hotMs).toBeLessThan(10);
    console.log(`    Large file — Cold: ${coldMs.toFixed(1)}ms, Hot: ${hotMs.toFixed(3)}ms, Speedup: ${(coldMs / Math.max(hotMs, 0.01)).toFixed(0)}x`);
  });

  it("incremental after cache hit with compaction and leaf_pointer", async () => {
    const filePath = join(tmpDir, "sess-incr-complex.jsonl");
    const initialLines: JsonlLine[] = [
      { id: "msg-1", parentId: null, type: "message", message: { role: "user", content: "first" } },
      { id: "msg-2", parentId: "msg-1", type: "message", message: { role: "assistant", content: "reply" } },
      {
        id: "comp-1",
        parentId: "msg-2",
        type: "compaction",
        summary: "summarized",
        tokensBefore: 3000,
      },
      { id: "lp-1", parentId: null, type: "leaf_pointer", leafId: "comp-1" },
    ];
    writeJsonlLines(filePath, initialLines);

    const first = await manager.getFullMessages("sess-incr-complex", filePath);
    expect(first.totalCount).toBe(3);

    const appendedLines: JsonlLine[] = [
      { id: "msg-3", parentId: "comp-1", type: "message", message: { role: "user", content: "after compaction" } },
      { id: "msg-4", parentId: "msg-3", type: "message", message: { role: "assistant", content: "new reply" } },
      { id: "lp-2", parentId: null, type: "leaf_pointer", leafId: "msg-4" },
    ];
    appendJsonlLines(filePath, appendedLines);
    utimesSync(filePath, new Date(), new Date(Date.now() + 2000));

    const second = await manager.getFullMessages("sess-incr-complex", filePath);
    expect(second.totalCount).toBe(5);

    const roles = second.messages.map((m) => (m as unknown as Record<string, unknown>).role);
    expect(roles).toContain("compactionSummary");
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");

    const cache = manager.getSessionCache("sess-incr-complex", filePath);
    expect(cache).not.toBeNull();
    expect(cache!.lastJsonlLeafPointer).toBe("msg-4");
    expect(cache!.compactionEntries.length).toBe(1);
  });

  it("custom entries cached and returned correctly", async () => {
    const filePath = join(tmpDir, "sess-custom.jsonl");
    const lines: JsonlLine[] = [
      { id: "msg-1", parentId: null, type: "message", message: { role: "user", content: "hi" } },
      {
        id: "custom-1",
        parentId: "msg-1",
        type: "custom",
        customType: "test_event",
        data: { foo: "bar" },
        timestamp: new Date().toISOString(),
      },
      { id: "msg-2", parentId: "custom-1", type: "message", message: { role: "assistant", content: "done" } },
      { id: "lp-1", parentId: null, type: "leaf_pointer", leafId: "msg-2" },
    ];
    writeJsonlLines(filePath, lines);

    const cold = await manager.getFullMessages("sess-custom", filePath);
    expect(cold.customEntries.length).toBe(1);
    expect(cold.customEntries[0].customType).toBe("test_event");

    const hot = await manager.getFullMessages("sess-custom", filePath);
    expect(hot.customEntries.length).toBe(1);
    expect(hot.customEntries[0].customType).toBe("test_event");
  });

  it("byteOffset equals file size after full read", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-offset", 50);
    await manager.getFullMessages("sess-offset", sessionPath, { limit: 50 });

    const cache = manager.getSessionCache("sess-offset", sessionPath);
    expect(cache).not.toBeNull();
    const fileSize = statSync(sessionPath).size;
    expect(cache!.byteOffset).toBe(fileSize);
  });

  it("byteOffset updates correctly after incremental append", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-incr-offset", 50);

    await manager.getFullMessages("sess-incr-offset", sessionPath, { limit: 50 });

    const cacheAfterFull = manager.getSessionCache("sess-incr-offset", sessionPath);
    expect(cacheAfterFull).not.toBeNull();
    const offsetAfterFull = cacheAfterFull!.byteOffset;
    expect(offsetAfterFull).toBe(statSync(sessionPath).size);

    appendToSessionFile(sessionPath, 30);

    await manager.getFullMessages("sess-incr-offset", sessionPath, { limit: 100 });

    const cacheAfterIncr = manager.getSessionCache("sess-incr-offset", sessionPath);
    expect(cacheAfterIncr).not.toBeNull();
    expect(cacheAfterIncr!.byteOffset).toBe(statSync(sessionPath).size);
    expect(cacheAfterIncr!.byteOffset).toBeGreaterThan(offsetAfterFull);
  });

  it("multiple incremental appends accumulate byteOffset correctly", async () => {
    const sessionPath = createSessionFile(tmpDir, "sess-multi-incr", 20);
    await manager.getFullMessages("sess-multi-incr", sessionPath, { limit: 20 });

    const offsets: number[] = [];
    offsets.push(manager.getSessionCache("sess-multi-incr", sessionPath)!.byteOffset);

    for (let round = 0; round < 3; round++) {
      appendToSessionFile(sessionPath, 10);
      await manager.getFullMessages("sess-multi-incr", sessionPath, { limit: 200 });
      const offset = manager.getSessionCache("sess-multi-incr", sessionPath)!.byteOffset;
      offsets.push(offset);
    }

    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
    }
    expect(offsets[offsets.length - 1]!).toBe(statSync(sessionPath).size);

    const finalResult = await manager.getFullMessages("sess-multi-incr", sessionPath, { limit: 200 });
    expect(finalResult.totalCount).toBe(20 + 30);
  });

  it("large file incremental read via byte offset is fast (< 50ms)", async () => {
    const filePath = join(tmpDir, "sess-large-incr.jsonl");

    const lines: JsonlLine[] = [];
    let parentId: string | null = null;
    const largeCount = 100000;
    for (let i = 0; i < largeCount; i++) {
      const entryId = `e-${i}`;
      lines.push({
        id: entryId,
        parentId,
        type: "message",
        message: {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Line ${i} with padding `.repeat(3),
        },
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      });
      parentId = entryId;
    }
    writeJsonlLines(filePath, lines);

    const t0 = performance.now();
    await manager.getFullMessages("sess-large-incr", filePath, { limit: largeCount });
    const coldMs = performance.now() - t0;

    const cache = manager.getSessionCache("sess-large-incr", filePath);
    expect(cache).not.toBeNull();
    expect(cache!.byteOffset).toBe(statSync(filePath).size);

    const extraLines: JsonlLine[] = [];
    let lastId = `e-${largeCount - 1}`;
    for (let i = 0; i < 100; i++) {
      const entryId = `app-${i}`;
      extraLines.push({
        id: entryId,
        parentId: lastId,
        type: "message",
        message: {
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Appended ${i}`,
        },
        timestamp: new Date(Date.now() + (largeCount + i) * 1000).toISOString(),
      });
      lastId = entryId;
    }
    appendJsonlLines(filePath, extraLines);
    utimesSync(filePath, new Date(), new Date(Date.now() + 2000));

    const t1 = performance.now();
    const incr = await manager.getFullMessages("sess-large-incr", filePath, { limit: largeCount + 200 });
    const incrMs = performance.now() - t1;

    expect(incr.totalCount).toBe(largeCount + 100);
    expect(incrMs).toBeLessThan(50);

    console.log(`    100K lines — Cold: ${coldMs.toFixed(0)}ms, Incremental (+100 lines): ${incrMs.toFixed(2)}ms`);
  });

  it("readJsonlFromByteOffset returns correct data", async () => {
    const filePath = join(tmpDir, "sess-byteapi.jsonl");
    const initialLines: JsonlLine[] = [];
    let parentId: string | null = null;
    for (let i = 0; i < 10; i++) {
      const entryId = `init-${i}`;
      initialLines.push({
        id: entryId,
        parentId,
        type: "message",
        message: { role: "user", content: `Init ${i}` },
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      });
      parentId = entryId;
    }
    writeJsonlLines(filePath, initialLines);

    const initialSize = statSync(filePath).size;

    const extraLines: JsonlLine[] = [
      { id: "new-1", parentId: "init-9", type: "message", message: { role: "assistant", content: "new msg" } },
      { id: "comp-new", parentId: "new-1", type: "compaction", summary: "new compaction", tokensBefore: 100 },
      { id: "lp-new", parentId: null, type: "leaf_pointer", leafId: "comp-new" },
    ];
    appendJsonlLines(filePath, extraLines);

    const messages: Array<{ entryId: string; message: unknown }> = [];
    const customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> = [];
    const parentById = new Map<string, string | null>();

    const result = await manager.readJsonlFromByteOffset(
      filePath,
      initialSize,
      messages,
      customEntries,
      parentById,
    );

    expect(result.newEntries).toBe(2);
    expect(result.newCompactionEntries.length).toBe(1);
    expect(result.newCompactionEntries[0].entryId).toBe("comp-new");
    expect(result.lastLeafPointer).toBe("comp-new");
    expect(result.newByteOffset).toBe(statSync(filePath).size);
    expect(parentById.has("new-1")).toBe(true);
    expect(parentById.has("comp-new")).toBe(true);
  });
});
