/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  ensureManagedClientOperation,
  findSandboxUserIdForSession,
} from "../src/shared/agent/agent-managed-client-operations";

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
});
