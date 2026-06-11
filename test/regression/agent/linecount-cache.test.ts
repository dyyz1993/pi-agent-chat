/**
 * @vitest-environment node
 *
 * Tests: lineCount cache correctness in getSessionCache / setSessionCache
 *
 * Bug: getSessionCache() returns a shallow copy ({ ...cached }), but after
 * updating cached.lineCount = result.totalLines, the old setSessionCache()
 * used `updatedCached?.lineCount` which read from the original Map entry
 * (stale value). This caused the next delta read to start from the wrong
 * line, producing duplicate entries.
 *
 * Fix: setSessionCache() now uses `cached.lineCount` (the updated copy).
 */
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: { piCliPath: "/fake", piExtensionsDir: "/fake" },
}));
vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
  sessionMsgCache: Map<
    string,
    {
      messages: Array<{ entryId: string; message: unknown }>;
      customEntries: Array<{
        id: string;
        customType: string;
        data: unknown;
        timestamp: number;
      }>;
      parentById: Map<string, string | null>;
      fileSize: number;
      mtimeMs: number;
      lineCount: number;
    }
  >;
}

function mgr(manager: AgentProcessManager): InternalAPM {
  return manager as unknown as InternalAPM;
}

const TMP = join("/tmp", "pi-linecount-cache-test");

function header(sid: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: sid,
    timestamp: new Date().toISOString(),
    cwd: "/t",
  });
}

function msg(id: string, parentId: string | null, role: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text: `${role}-${id}` }] },
  });
}

class MockRPC {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

describe("lineCount cache correctness", () => {
  let sf: string;

  beforeEach(() => {
    mkdirSync(TMP, { recursive: true });
    sf = join(TMP, `lc-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      // intentional empty — cleanup best-effort
    }
  });

  it("incremental read after append uses correct lineCount — no duplicates", async () => {
    writeFileSync(
      sf,
      [header("s1"), msg("m1", "s1", "user"), msg("m2", "m1", "assistant")].join("\n"),
    );

    const manager = new AgentProcessManager(new MockRPC() as never);
    mgr(manager).sessionPaths.set("s1", sf);

    const r1 = await manager.getFullMessages("s1", sf);
    expect(r1.totalCount).toBe(2);

    appendFileSync(sf, "\n" + msg("m3", "m2", "user"));
    appendFileSync(sf, "\n" + msg("m4", "m3", "assistant"));

    const r2 = await manager.getFullMessages("s1", sf);
    expect(r2.totalCount).toBe(4);
    const roles = r2.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("two rollbacks with appended messages produce no duplicates", async () => {
    writeFileSync(
      sf,
      [
        header("s1"),
        msg("m1", "s1", "user"),
        msg("m2", "m1", "assistant"),
        msg("m3", "m2", "user"),
        msg("m4", "m3", "assistant"),
      ].join("\n"),
    );

    const manager = new AgentProcessManager(new MockRPC() as never);
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.navigateTree("s1", "m2");
    const r1 = await manager.getFullMessages("s1", sf);
    expect(r1.totalCount).toBe(2);
    expect(r1.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);

    appendFileSync(sf, "\n" + msg("m5", "m2", "user"));
    appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));

    const r2 = await manager.getFullMessages("s1", sf);
    expect(r2.totalCount).toBe(4);

    await manager.navigateTree("s1", "m2");
    const r3 = await manager.getFullMessages("s1", sf);
    expect(r3.totalCount).toBe(2);

    appendFileSync(sf, "\n" + msg("m7", "m2", "user"));
    appendFileSync(sf, "\n" + msg("m8", "m7", "assistant"));

    const r4 = await manager.getFullMessages("s1", sf);
    expect(r4.totalCount).toBe(4);

    const contents = r4.messages.map(
      (m: { content: Array<{ text: string }> }) => m.content[0].text,
    );
    const uniqueContents = new Set(contents);
    expect(uniqueContents.size).toBe(contents.length);
  });

  it("cache lineCount matches actual file lines after each operation", async () => {
    writeFileSync(
      sf,
      [header("s1"), msg("m1", "s1", "user"), msg("m2", "m1", "assistant")].join("\n"),
    );

    const manager = new AgentProcessManager(new MockRPC() as never);
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.getFullMessages("s1", sf);
    const cache1 = mgr(manager).sessionMsgCache.get("s1");
    expect(cache1).toBeDefined();
    expect(cache1!.lineCount).toBe(3);

    appendFileSync(sf, "\n" + msg("m3", "m2", "user"));
    appendFileSync(sf, "\n" + msg("m4", "m3", "assistant"));

    await manager.getFullMessages("s1", sf);
    const cache2 = mgr(manager).sessionMsgCache.get("s1");
    expect(cache2).toBeDefined();
    expect(cache2!.lineCount).toBe(5);

    appendFileSync(sf, "\n" + msg("m5", "m4", "user"));

    await manager.getFullMessages("s1", sf);
    const cache3 = mgr(manager).sessionMsgCache.get("s1");
    expect(cache3).toBeDefined();
    expect(cache3!.lineCount).toBe(6);
  });

  it("multiple successive appends — lineCount stays accurate and no duplicates", async () => {
    writeFileSync(
      sf,
      [header("s1"), msg("m1", "s1", "user"), msg("m2", "m1", "assistant")].join("\n"),
    );

    const manager = new AgentProcessManager(new MockRPC() as never);
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.getFullMessages("s1", sf);

    for (let i = 3; i <= 7; i++) {
      appendFileSync(sf, "\n" + msg(`m${i}`, `m${i - 1}`, i % 2 === 1 ? "user" : "assistant"));
      const result = await manager.getFullMessages("s1", sf);
      expect(result.totalCount).toBe(i);

      const contents = result.messages.map(
        (m: { content: Array<{ text: string }> }) => m.content[0].text,
      );
      expect(new Set(contents).size).toBe(contents.length);
    }
  });
});
