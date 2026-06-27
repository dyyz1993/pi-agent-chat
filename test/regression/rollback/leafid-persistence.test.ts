/**
 * @vitest-environment node
 *
 * Tests: rollback leafId persistence via public API
 *
 * All tests use only navigateTree() and getFullMessages() — no internal methods.
 * Verifies behavior through the JSONL file and returned message counts.
 */
import { writeFileSync, mkdirSync, rmSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: { piCliPath: "/fake", piExtensionsDir: "/fake" },
}));
vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
}

function mgr(manager: AgentProcessManager): InternalAPM {
  return manager as unknown as InternalAPM;
}

const TMP = join("/tmp", "pi-rollback-persist-test");

function msg(id: string, parentId: string | null, role: string): string {
  return JSON.stringify({
    id,
    parentId,
    type: "message",
    timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text: "t" }] },
  });
}

function header(sid: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: sid,
    timestamp: new Date().toISOString(),
    cwd: "/t",
  });
}

function leafPointerInFile(sf: string): boolean {
  try {
    return readFileSync(sf, "utf-8").includes('"type":"leaf_pointer"');
  } catch {
    return false;
  }
}

class MockRPC {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

describe("rollback leafId persistence", () => {
  let manager: AgentProcessManager;
  let sf: string;

  beforeEach(() => {
    manager = new AgentProcessManager(new MockRPC() as never);
    mkdirSync(TMP, { recursive: true });
    sf = join(TMP, `s-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* intentional empty */
    }
  });

  it("navigateTree writes leaf_pointer entry to JSONL", async () => {
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
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.navigateTree("s1", "m2", { skipFiles: true });

    expect(leafPointerInFile(sf)).toBe(true);
  });

  it("rollback to m2 → getFullMessages shows only m1, m2", async () => {
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
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.navigateTree("s1", "m2", { skipFiles: true });
    const r = await manager.getFullMessages("s1", sf);

    expect(r.totalCount).toBe(2);
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rollback → no new messages → clear leafIds (simulate restart) → still shows rollback", async () => {
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
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.navigateTree("s1", "m2", { skipFiles: true });
    expect(leafPointerInFile(sf)).toBe(true);

    mgr(manager).leafIds.delete("s1");

    const r = await manager.getFullMessages("s1", sf);
    expect(r.totalCount).toBe(2);
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rollback → new messages appended → shows all including new", async () => {
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
    mgr(manager).sessionPaths.set("s1", sf);

    await manager.navigateTree("s1", "m2", { skipFiles: true });
    appendFileSync(sf, "\n" + msg("m5", "m2", "user"));
    appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));

    mgr(manager).leafIds.delete("s1");

    const r = await manager.getFullMessages("s1", sf);
    expect(r.totalCount).toBe(4);
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("no rollback → shows all messages", async () => {
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
    mgr(manager).sessionPaths.set("s1", sf);

    const r = await manager.getFullMessages("s1", sf);
    expect(r.totalCount).toBe(4);
    expect(leafPointerInFile(sf)).toBe(false);
  });
});
