import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock(import("../../../src/shared/lib/project-config"), () => ({
  listRecentProjects: vi.fn().mockResolvedValue([]),
  listPinnedSessionIds: vi.fn().mockResolvedValue([]),
}));

import { scanSessionDir } from "../../../src/shared/lib/session-scanner";

const TEST_ROOT = join(tmpdir(), `pi-ss-test-${process.pid}`);
const TEST_SESSIONS_DIR = join(TEST_ROOT, "sessions");
const TEST_PROJECT_DIR = join(TEST_ROOT, "project");

function makeJsonlContent(id: string, cwd: string) {
  const header = JSON.stringify({
    type: "session",
    version: 1,
    id,
    timestamp: "2026-01-01T00:00:00Z",
    cwd,
  });
  const msg = JSON.stringify({
    type: "message",
    message: { role: "user", content: [{ type: "text", text: "hello from " + id }] },
  });
  return header + "\n" + msg + "\n";
}

async function createSessionFile(id: string, cwd = TEST_PROJECT_DIR) {
  const filePath = join(TEST_SESSIONS_DIR, `${id}.jsonl`);
  await writeFile(filePath, makeJsonlContent(id, cwd), "utf-8");
  return filePath;
}

describe("scanSessionDir two-phase optimization", () => {
  beforeEach(async () => {
    await mkdir(TEST_SESSIONS_DIR, { recursive: true });
    await mkdir(TEST_PROJECT_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true }).catch(() => {});
  });

  it("empty directory returns empty array", async () => {
    const result = await scanSessionDir(TEST_SESSIONS_DIR);
    expect(result).toEqual([]);
  });

  it("non-existent directory returns empty array", async () => {
    const result = await scanSessionDir(join(TEST_ROOT, "no-such-dir"));
    expect(result).toEqual([]);
  });

  it("processes files and returns session metadata", async () => {
    await createSessionFile("sess-001");
    await createSessionFile("sess-002");

    const result = await scanSessionDir(TEST_SESSIONS_DIR);

    expect(result.length).toBe(2);
    const ids = result.map((r) => r.sessionId).sort();
    expect(ids).toEqual(["sess-001", "sess-002"]);
  });

  it("preserves delegated session agent metadata from the JSONL header", async () => {
    const filePath = join(TEST_SESSIONS_DIR, "delegate-rust.jsonl");
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "delegate-rust",
          timestamp: "2026-01-01T00:00:00Z",
          cwd: TEST_PROJECT_DIR,
          delegateParentSessionId: "parent",
          agent: "rust",
        }),
        JSON.stringify({
          type: "delegate_info",
          id: "delegate_info",
          delegateParentSessionId: "parent",
          delegateType: "coordinator",
          agent: "rust",
        }),
      ].join("\n"),
      "utf-8",
    );

    const result = await scanSessionDir(TEST_SESSIONS_DIR);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sessionId: "delegate-rust",
      delegateParentSessionId: "parent",
      delegateType: "coordinator",
      agent: "rust",
    });
  });

  it("when files > 120, only returns up to 100 after processing", async () => {
    const promises = [];
    for (let i = 0; i < 150; i++) {
      promises.push(createSessionFile(`sess-${String(i).padStart(4, "0")}`));
    }
    await Promise.all(promises);

    const result = await scanSessionDir(TEST_SESSIONS_DIR);

    expect(result.length).toBe(100);
  });

  it("pinned files appear first in results", async () => {
    await createSessionFile("a");
    await createSessionFile("b");
    await createSessionFile("c");

    const result = await scanSessionDir(TEST_SESSIONS_DIR, new Set(["b"]));

    expect(result[0].sessionId).toBe("b");
    expect(result[0].pinned).toBe(true);
    expect(result.length).toBe(3);
  });

  it("empty files (size=0) are skipped", async () => {
    await writeFile(join(TEST_SESSIONS_DIR, "empty.jsonl"), "", "utf-8");
    await createSessionFile("valid");

    const result = await scanSessionDir(TEST_SESSIONS_DIR);

    expect(result.length).toBe(1);
    expect(result[0].sessionId).toBe("valid");
  });

  it("non-jsonl files are ignored", async () => {
    await writeFile(join(TEST_SESSIONS_DIR, "notes.txt"), "hello", "utf-8");
    await createSessionFile("sess-001");

    const result = await scanSessionDir(TEST_SESSIONS_DIR);

    expect(result.length).toBe(1);
    expect(result[0].sessionId).toBe("sess-001");
  });

  it("with 500 files, completes within reasonable time (two-phase optimization)", async () => {
    const promises = [];
    for (let i = 0; i < 500; i++) {
      promises.push(createSessionFile(`sess-${String(i).padStart(4, "0")}`));
    }
    await Promise.all(promises);

    const start = performance.now();
    const result = await scanSessionDir(TEST_SESSIONS_DIR);
    const elapsed = performance.now() - start;

    expect(result.length).toBe(100);

    // Two-phase optimization should complete in < 5s even with 500 files
    // because only 120 files get header+meta parsing (not all 500)
    expect(elapsed).toBeLessThan(5000);
  });

  it("with exactly 120 files, all are processed", async () => {
    const promises = [];
    for (let i = 0; i < 120; i++) {
      promises.push(createSessionFile(`sess-${String(i).padStart(4, "0")}`));
    }
    await Promise.all(promises);

    const result = await scanSessionDir(TEST_SESSIONS_DIR);

    expect(result.length).toBe(100);
  });

  it("pinned file with old mtime included even when 200 newer files exist", async () => {
    await createSessionFile("old-pinned");

    const statPath = join(TEST_SESSIONS_DIR, "old-pinned.jsonl");
    const { utimes } = await import("fs/promises");
    await utimes(statPath, new Date("2020-01-01"), new Date("2020-01-01"));

    for (let i = 0; i < 200; i++) {
      await writeFile(
        join(TEST_SESSIONS_DIR, `new-${String(i).padStart(4, "0")}.jsonl`),
        makeJsonlContent(`new-${String(i).padStart(4, "0")}`, TEST_PROJECT_DIR),
        "utf-8",
      );
    }

    const result = await scanSessionDir(TEST_SESSIONS_DIR, new Set(["old-pinned"]));

    const pinned = result.find((r) => r.sessionId === "old-pinned");
    expect(pinned).toBeDefined();
    expect(pinned!.pinned).toBe(true);
    expect(result[0].sessionId).toBe("old-pinned");
    expect(result.length).toBe(100);
  });
});
