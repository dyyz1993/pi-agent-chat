/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/pi",
    sandboxEnabled: false,
  },
}));

import {
  startAgentClientOperation,
  type StartManagedClient,
} from "../../../src/shared/agent/agent-start-operations";

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue(vi.fn()),
    channel: vi.fn().mockReturnValue({ onReceive: vi.fn() }),
    ...overrides,
  };
}

function makeManaged(sessionId: string, projectPath = "/repo"): StartManagedClient {
  return {
    client: makeClient(),
    info: {
      sessionId,
      projectPath,
      sessionPath: `/sessions/${sessionId}.jsonl`,
      status: "idle",
      holdEvents: [],
    },
    unsubscribe: vi.fn(),
    _activeSessionId: sessionId,
    lastActiveAt: 1,
    activeBackgroundTools: new Set(),
  } as StartManagedClient;
}

function makeOptions(overrides: Partial<Parameters<typeof startAgentClientOperation>[0]> = {}) {
  const clients = new Map<string, StartManagedClient>();
  const processByCwd = new Map<string, Set<StartManagedClient>>();
  const sessionPaths = new Map<string, string>();
  const sessionProjectPaths = new Map<string, string>();
  return {
    sessionId: "sess-1",
    projectPath: "/repo",
    sessionPath: "/sessions/sess-1.jsonl",
    clients,
    processByCwd,
    sessionPaths,
    sessionProjectPaths,
    getPoolKey: (projectPath: string, userId?: string) =>
      userId ? `${projectPath}::${userId}` : projectPath,
    evictLRU: vi.fn(),
    addToPool: vi.fn((poolKey: string, managed: StartManagedClient) => {
      let pool = processByCwd.get(poolKey);
      if (!pool) {
        pool = new Set();
        processByCwd.set(poolKey, pool);
      }
      pool.add(managed);
    }),
    createRpcClient: vi.fn().mockResolvedValue({
      client: makeClient(),
      timings: { dynamicImport: 1, construct: 2 },
    }),
    registerAgentChannels: vi.fn().mockReturnValue(3),
    handleEvent: vi.fn(),
    handleCoordinatorCall: vi.fn(),
    broadcastSessionStatus: vi.fn(),
    now: () => 42,
    ...overrides,
  };
}

describe("agent start operations", () => {
  it("returns already_running and refreshes activity for the active session", async () => {
    const managed = makeManaged("sess-1");
    const options = makeOptions({
      clients: new Map([["sess-1", managed]]),
    });

    await expect(startAgentClientOperation(options)).resolves.toEqual({
      agentId: "sess-1",
      status: "already_running",
    });
    expect(managed.lastActiveAt).toBe(42);
    expect(options.createRpcClient).not.toHaveBeenCalled();
  });

  it("starts a new client instead of switching an existing pooled process", async () => {
    const pooled = makeManaged("old-session");
    const processByCwd = new Map([["/repo", new Set([pooled])]]);
    const clients = new Map([["old-session", pooled]]);
    const sessionPaths = new Map<string, string>();
    const sessionProjectPaths = new Map<string, string>();
    const options = makeOptions({
      clients,
      processByCwd,
      sessionPaths,
      sessionProjectPaths,
    });

    await expect(startAgentClientOperation(options)).resolves.toEqual({
      agentId: "sess-1",
      status: "started",
    });

    expect(clients.get("old-session")).toBe(pooled);
    expect(clients.get("sess-1")).not.toBe(pooled);
    expect(pooled._activeSessionId).toBe("old-session");
    expect(sessionPaths.get("sess-1")).toBe("/sessions/sess-1.jsonl");
    expect(options.createRpcClient).toHaveBeenCalled();
  });

  it("creates a new client, subscribes events, registers channels, and broadcasts idle", async () => {
    const options = makeOptions();

    await expect(startAgentClientOperation(options)).resolves.toEqual({
      agentId: "sess-1",
      status: "started",
    });

    const managed = options.clients.get("sess-1");
    expect(managed).toBeDefined();
    expect(options.evictLRU).toHaveBeenCalledWith("/repo");
    expect(options.createRpcClient).toHaveBeenCalledWith(
      "/fake/pi",
      "/repo",
      "/sessions/sess-1.jsonl",
      undefined,
    );
    expect(options.registerAgentChannels).toHaveBeenCalled();
    expect(options.broadcastSessionStatus).toHaveBeenCalledWith("sess-1", "idle");
    expect(options.sessionProjectPaths.get("sess-1")).toBe("/repo");
  });

  it("does not stop a pooled process when starting another session", async () => {
    const pooled = makeManaged("old-session");
    const processByCwd = new Map([["/repo", new Set([pooled])]]);
    const clients = new Map([["old-session", pooled]]);
    const options = makeOptions({ clients, processByCwd });

    await expect(startAgentClientOperation(options)).resolves.toEqual({
      agentId: "sess-1",
      status: "started",
    });

    expect(pooled.unsubscribe).not.toHaveBeenCalled();
    expect(pooled.client.stop).not.toHaveBeenCalled();
    expect(clients.get("old-session")).toBe(pooled);
    expect(options.createRpcClient).toHaveBeenCalled();
  });
});
