/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  ensureManagedClientOperation,
  findSandboxUserIdForSession,
} from "../../../src/shared/agent/agent-managed-client-operations";

interface TestManagedClient {
  info: {
    projectPath: string;
    sessionPath: string;
  };
  _activeSessionId: string;
}

function makeManaged(sessionId: string, projectPath = "/project"): TestManagedClient {
  return {
    info: {
      projectPath,
      sessionPath: `/sessions/${sessionId}.jsonl`,
    },
    _activeSessionId: sessionId,
  };
}

describe("agent managed client operations", () => {
  it("returns an active managed client without rebuilding", async () => {
    const managed = makeManaged("sess-1");
    const start = vi.fn();

    await expect(
      ensureManagedClientOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        sessionProjectPaths: new Map(),
        sessionPaths: new Map(),
        findSessionById: vi.fn(),
        sandboxEnabled: false,
        getSandboxUserId: vi.fn(),
        start,
      }),
    ).resolves.toBe(managed);

    expect(start).not.toHaveBeenCalled();
  });

  it("rebuilds from scanned session metadata and persists it", async () => {
    const managed = makeManaged("sess-1");
    const active = new Map<string, TestManagedClient>();
    const sessionProjectPaths = new Map<string, string>();
    const sessionPaths = new Map<string, string>();
    const start = vi.fn().mockImplementation(async () => {
      active.set("sess-1", managed);
      return { status: "started" };
    });

    await expect(
      ensureManagedClientOperation({
        sessionId: "sess-1",
        getActiveManaged: (id) => active.get(id) ?? null,
        sessionProjectPaths,
        sessionPaths,
        findSessionById: vi.fn().mockResolvedValue({
          projectPath: "/project",
          sessionPath: "/sessions/sess-1.jsonl",
        }),
        sandboxEnabled: true,
        getSandboxUserId: () => "sandbox-user",
        start,
      }),
    ).resolves.toBe(managed);

    expect(sessionProjectPaths.get("sess-1")).toBe("/project");
    expect(sessionPaths.get("sess-1")).toBe("/sessions/sess-1.jsonl");
    expect(start).toHaveBeenCalledWith("sess-1", "/project", "/sessions/sess-1.jsonl", {
      forceNewProcess: false,
      userId: "sandbox-user",
    });
  });

  it("returns null when metadata is unavailable or rebuild fails", async () => {
    await expect(
      ensureManagedClientOperation({
        sessionId: "missing",
        getActiveManaged: () => null,
        sessionProjectPaths: new Map(),
        sessionPaths: new Map(),
        findSessionById: vi.fn().mockResolvedValue(null),
        sandboxEnabled: false,
        getSandboxUserId: vi.fn(),
        start: vi.fn(),
      }),
    ).resolves.toBeNull();

    await expect(
      ensureManagedClientOperation({
        sessionId: "sess-1",
        getActiveManaged: () => null,
        sessionProjectPaths: new Map([["sess-1", "/project"]]),
        sessionPaths: new Map([["sess-1", "/sessions/sess-1.jsonl"]]),
        findSessionById: vi.fn(),
        sandboxEnabled: false,
        getSandboxUserId: vi.fn(),
        start: vi.fn().mockRejectedValue(new Error("start failed")),
      }),
    ).resolves.toBeNull();
  });

  it("finds sandbox user ids from process pool keys", () => {
    const managed = makeManaged("sess-1", "/project");
    expect(
      findSandboxUserIdForSession({
        sessionId: "sess-1",
        sandboxEnabled: true,
        processByCwd: new Map([["/project::user-1", new Set([managed])]]),
        clients: new Map(),
      }),
    ).toBe("user-1");

    expect(
      findSandboxUserIdForSession({
        sessionId: "sess-1",
        sandboxEnabled: false,
        processByCwd: new Map([["/project::user-1", new Set([managed])]]),
        clients: new Map([["sess-1", managed]]),
      }),
    ).toBeNull();
  });

  describe("concurrent dedup", () => {
    it("only calls start() once when multiple callers race for the same session", async () => {
      const managed = makeManaged("sess-dedup");
      const active = new Map<string, TestManagedClient>();
      let startCallCount = 0;

      const start = vi.fn().mockImplementation(async () => {
        startCallCount++;
        // Simulate slow start (e.g. CLI process boot)
        await new Promise((r) => setTimeout(r, 200));
        active.set("sess-dedup", managed);
        return { status: "started" };
      });

      // Fire 5 concurrent ensureManagedClient calls for the same session
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          ensureManagedClientOperation({
            sessionId: "sess-dedup",
            getActiveManaged: (id) => active.get(id) ?? null,
            sessionProjectPaths: new Map([["sess-dedup", "/project"]]),
            sessionPaths: new Map([["sess-dedup", "/sessions/sess-dedup.jsonl"]]),
            findSessionById: vi.fn(),
            sandboxEnabled: false,
            getSandboxUserId: vi.fn(),
            start,
          }),
        ),
      );

      // start() should have been called exactly once
      expect(startCallCount).toBe(1);
      // All callers should get the managed client
      for (const r of results) {
        expect(r).toBe(managed);
      }
    });

    it("allows different sessions to start in parallel", async () => {
      const active = new Map<string, TestManagedClient>();
      const startOrder: string[] = [];

      const start = vi.fn().mockImplementation(async (sessionId: string) => {
        startOrder.push(sessionId);
        await new Promise((r) => setTimeout(r, 50));
        active.set(sessionId, makeManaged(sessionId));
        return { status: "started" };
      });

      const results = await Promise.all([
        ensureManagedClientOperation({
          sessionId: "sess-a",
          getActiveManaged: (id) => active.get(id) ?? null,
          sessionProjectPaths: new Map([["sess-a", "/project-a"]]),
          sessionPaths: new Map([["sess-a", "/sessions/a.jsonl"]]),
          findSessionById: vi.fn(),
          sandboxEnabled: false,
          getSandboxUserId: vi.fn(),
          start,
        }),
        ensureManagedClientOperation({
          sessionId: "sess-b",
          getActiveManaged: (id) => active.get(id) ?? null,
          sessionProjectPaths: new Map([["sess-b", "/project-b"]]),
          sessionPaths: new Map([["sess-b", "/sessions/b.jsonl"]]),
          findSessionById: vi.fn(),
          sandboxEnabled: false,
          getSandboxUserId: vi.fn(),
          start,
        }),
      ]);

      // Both should succeed
      expect(results[0]).toBeTruthy();
      expect(results[1]).toBeTruthy();
      // Both sessions should have been started
      expect(startOrder).toContain("sess-a");
      expect(startOrder).toContain("sess-b");
    });

    it("cleans up pending map after failure so retry works", async () => {
      const active = new Map<string, TestManagedClient>();
      let callCount = 0;

      const start = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error("first start fails");
        active.set("sess-retry", makeManaged("sess-retry"));
        return { status: "started" };
      });

      // First call fails
      const r1 = await ensureManagedClientOperation({
        sessionId: "sess-retry",
        getActiveManaged: (id) => active.get(id) ?? null,
        sessionProjectPaths: new Map([["sess-retry", "/project"]]),
        sessionPaths: new Map([["sess-retry", "/sessions/retry.jsonl"]]),
        findSessionById: vi.fn(),
        sandboxEnabled: false,
        getSandboxUserId: vi.fn(),
        start,
      });
      expect(r1).toBeNull();

      // Second call should work (pending map was cleaned up)
      const r2 = await ensureManagedClientOperation({
        sessionId: "sess-retry",
        getActiveManaged: (id) => active.get(id) ?? null,
        sessionProjectPaths: new Map([["sess-retry", "/project"]]),
        sessionPaths: new Map([["sess-retry", "/sessions/retry.jsonl"]]),
        findSessionById: vi.fn(),
        sandboxEnabled: false,
        getSandboxUserId: vi.fn(),
        start,
      });
      expect(r2).toBeTruthy();
      expect(callCount).toBe(2);
    });
  });
});
