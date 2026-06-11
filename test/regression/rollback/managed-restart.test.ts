/**
 * @vitest-environment node
 *
 * Test: rollback persistence with managed client (CLI restart scenario)
 *
 * Simulates real app behavior:
 * 1. Rollback via managed client
 * 2. Restart app → new ProcessManager + new CLI (returns wrong leaf)
 * 3. getFullMessages should still use persisted leaf
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
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
  clients: Map<
    string,
    {
      client: { getTreeWithLeaf: () => Promise<{ leafId: string | null }> };
      info: {
        sessionId: string;
        projectPath: string;
        sessionPath: string;
        status: string;
        holdEvents: unknown[];
      };
      unsubscribe: () => void;
      _activeSessionId: string;
    }
  >;
}

function mgr(m: AgentProcessManager): InternalAPM {
  return m as unknown as InternalAPM;
}

const TMP = join("/tmp", "pi-rollback-managed-test");

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

class MockRPC {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

describe("managed client restart", () => {
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

  it("restart with managed client returning pre-rollback leaf → should use persisted leaf", async () => {
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

    // Phase 1: rollback with JSONL fallback (no managed client)
    const manager1 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager1).sessionPaths.set("s1", sf);
    await manager1.navigateTree("s1", "m2");

    const r1 = await manager1.getFullMessages("s1", sf);
    expect(r1.totalCount).toBe(2);

    // Phase 2: simulate restart
    // New ProcessManager + new CLI that returns wrong leaf (m4)
    const manager2 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager2).sessionPaths.set("s1", sf);

    // Set up mock managed client (simulating CLI restart)
    // CLI reads JSONL, doesn't understand leaf_pointer, returns m4 as leaf
    mgr(manager2).clients.set("s1", {
      client: {
        getTreeWithLeaf: vi.fn().mockResolvedValue({ leafId: "m4" }),
      },
      info: {
        sessionId: "s1",
        projectPath: "/t",
        sessionPath: sf,
        status: "idle",
        holdEvents: [],
      },
      unsubscribe: vi.fn(),
      _activeSessionId: "s1",
    });

    const r2 = await manager2.getFullMessages("s1", sf);
    expect(r2.totalCount).toBe(2);
    expect(r2.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("restart → CLI writes tier_config during startup → should still use persisted leaf", async () => {
    const { appendFileSync } = await import("node:fs");

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

    // Rollback
    const manager1 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager1).sessionPaths.set("s1", sf);
    await manager1.navigateTree("s1", "m2");

    // CLI startup appends tier_config after leaf_pointer
    appendFileSync(
      sf,
      "\n" +
        JSON.stringify({
          type: "custom",
          id: "tier-startup",
          customType: "session_tier_config",
          data: { tier: "pro" },
          timestamp: new Date().toISOString(),
        }),
    );

    // Restart with managed client
    const manager2 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager2).sessionPaths.set("s1", sf);
    mgr(manager2).clients.set("s1", {
      client: {
        getTreeWithLeaf: vi.fn().mockResolvedValue({ leafId: "m4" }),
      },
      info: {
        sessionId: "s1",
        projectPath: "/t",
        sessionPath: sf,
        status: "idle",
        holdEvents: [],
      },
      unsubscribe: vi.fn(),
      _activeSessionId: "s1",
    });

    const r = await manager2.getFullMessages("s1", sf);
    expect(r.totalCount).toBe(2);
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });

  it("rollback → chat → restart with managed client → should show all new messages", async () => {
    const { appendFileSync } = await import("node:fs");

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

    // Rollback to m2
    const manager1 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager1).sessionPaths.set("s1", sf);
    await manager1.navigateTree("s1", "m2");

    // User chats (new messages appended)
    appendFileSync(sf, "\n" + msg("m5", "m2", "user"));
    appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));

    // Restart with managed client that returns m6 as leaf
    const manager2 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager2).sessionPaths.set("s1", sf);
    mgr(manager2).clients.set("s1", {
      client: {
        getTreeWithLeaf: vi.fn().mockResolvedValue({ leafId: "m6" }),
      },
      info: {
        sessionId: "s1",
        projectPath: "/t",
        sessionPath: sf,
        status: "idle",
        holdEvents: [],
      },
      unsubscribe: vi.fn(),
      _activeSessionId: "s1",
    });

    const r = await manager2.getFullMessages("s1", sf);
    expect(r.totalCount).toBe(4);
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("rollback → chat → rollback → restart with managed client → should show second rollback state", async () => {
    const { appendFileSync } = await import("node:fs");

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

    // Rollback to m3
    const manager1 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager1).sessionPaths.set("s1", sf);
    await manager1.navigateTree("s1", "m3");

    // User chats from m3
    appendFileSync(sf, "\n" + msg("m5", "m3", "user"));
    appendFileSync(sf, "\n" + msg("m6", "m5", "assistant"));

    // Second rollback to m2
    await manager1.navigateTree("s1", "m2");

    // Restart with managed client that returns wrong leaf
    const manager2 = new AgentProcessManager(new MockRPC() as never);
    mgr(manager2).sessionPaths.set("s1", sf);
    mgr(manager2).clients.set("s1", {
      client: {
        getTreeWithLeaf: vi.fn().mockResolvedValue({ leafId: "m6" }),
      },
      info: {
        sessionId: "s1",
        projectPath: "/t",
        sessionPath: sf,
        status: "idle",
        holdEvents: [],
      },
      unsubscribe: vi.fn(),
      _activeSessionId: "s1",
    });

    const r = await manager2.getFullMessages("s1", sf);
    expect(r.totalCount).toBe(2);
    expect(r.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  });
});
