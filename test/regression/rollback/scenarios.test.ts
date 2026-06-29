/**
 * @vitest-environment node
 *
 * Tests: rollback scenarios reported by user
 *
 * Scenario 1: Rollback → restart (fresh ProcessManager) → should still show rollback state
 * Scenario 2: Rollback → chat → rollback again → should show only second rollback's messages
 * Scenario 3: Rollback → restart WITH managed client returning wrong leaf → should override with persisted leaf
 */
import { writeFileSync, mkdirSync, rmSync, appendFileSync } from "node:fs";
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

const TMP = join("/tmp", "pi-rollback-scenarios-test");

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

function tierConfig(): string {
  return JSON.stringify({
    type: "custom",
    id: `tier-${Date.now()}`,
    customType: "session_tier_config",
    data: { tier: "default" },
    timestamp: new Date().toISOString(),
  });
}

class MockRPC {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

describe("rollback scenarios", () => {
  let sf: string;

  beforeEach(() => {
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

  describe("Scenario 1: rollback → restart (fresh ProcessManager)", () => {
    it("fresh ProcessManager after rollback → should show rollback state", async () => {
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

      const manager1 = new AgentProcessManager(new MockRPC() as never);
      mgr(manager1).sessionPaths.set("s1", sf);
      await manager1.navigateTree("s1", "m2", { skipFiles: true });

      const r1 = await manager1.getFullMessages("s1", sf);
      expect(r1.totalCount).toBe(2);

      // Simulate restart: fresh ProcessManager
      const manager2 = new AgentProcessManager(new MockRPC() as never);
      mgr(manager2).sessionPaths.set("s1", sf);

      const r2 = await manager2.getFullMessages("s1", sf);
      expect(r2.totalCount).toBe(2);
      expect(r2.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    });

    it("fresh ProcessManager after rollback with tier_config appended after leaf_pointer → should still show rollback state", async () => {
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

      const manager1 = new AgentProcessManager(new MockRPC() as never);
      mgr(manager1).sessionPaths.set("s1", sf);
      await manager1.navigateTree("s1", "m2", { skipFiles: true });

      // CLI startup writes a tier_config AFTER leaf_pointer
      appendFileSync(sf, "\n" + tierConfig());

      // Simulate restart: fresh ProcessManager
      const manager2 = new AgentProcessManager(new MockRPC() as never);
      mgr(manager2).sessionPaths.set("s1", sf);

      const r = await manager2.getFullMessages("s1", sf);
      expect(r.totalCount).toBe(2);
      expect(r.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    });
  });

  describe("Scenario 2: rollback → chat → rollback again", () => {
    it("rollback to m2 → add m5,m6 → rollback to m2 again → should show only m1,m2", async () => {
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

      // First rollback to m2
      await manager.navigateTree("s1", "m2", { skipFiles: true });
      const r1 = await manager.getFullMessages("s1", sf);
      expect(r1.totalCount).toBe(2);

      // User chats: new messages appended
      appendFileSync(sf, "\n" + msg("m5", "m2", "user"));
      appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));

      const r2 = await manager.getFullMessages("s1", sf);
      expect(r2.totalCount).toBe(4);

      // Second rollback to m2
      await manager.navigateTree("s1", "m2", { skipFiles: true });
      const r3 = await manager.getFullMessages("s1", sf);
      expect(r3.totalCount).toBe(2);
      expect(r3.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    });

    it("rollback to m3 → add m5,m6 → rollback to m2 → should show only m1,m2", async () => {
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

      // First rollback to user message m3. Current rollback semantics restore to
      // the branch point before that user turn, so the active leaf becomes m2.
      await manager.navigateTree("s1", "m3", { skipFiles: true });
      const r1 = await manager.getFullMessages("s1", sf);
      expect(r1.totalCount).toBe(2);

      // User chats from the restored branch point m2
      appendFileSync(sf, "\n" + msg("m5", "m2", "user"));
      appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));

      const r2 = await manager.getFullMessages("s1", sf);
      expect(r2.totalCount).toBe(4);

      // Second rollback to m2 (deeper)
      await manager.navigateTree("s1", "m2", { skipFiles: true });
      const r3 = await manager.getFullMessages("s1", sf);
      expect(r3.totalCount).toBe(2);
      expect(r3.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    });
  });

  describe("Scenario 3: rollback → chat → rollback → restart", () => {
    it("rollback → chat → rollback → fresh ProcessManager → should show second rollback state", async () => {
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

      const manager1 = new AgentProcessManager(new MockRPC() as never);
      mgr(manager1).sessionPaths.set("s1", sf);

      await manager1.navigateTree("s1", "m3", { skipFiles: true });
      appendFileSync(sf, "\n" + msg("m5", "m3", "user"));
      appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));
      await manager1.navigateTree("s1", "m2", { skipFiles: true });

      // Simulate restart
      const manager2 = new AgentProcessManager(new MockRPC() as never);
      mgr(manager2).sessionPaths.set("s1", sf);

      const r = await manager2.getFullMessages("s1", sf);
      expect(r.totalCount).toBe(2);
      expect(r.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    });
  });
});
