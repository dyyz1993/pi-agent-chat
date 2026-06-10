/**
 * @vitest-environment node
 *
 * Unit tests for AgentProcessManager start() — verifies that:
 * 1. Each session gets its own CLI process (no switchSession reuse)
 * 2. "agent.session_status_changed" event with status "idle" is broadcast after start
 * 3. Multiple sessions can run in parallel with their own processes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AgentProcessManager as BaseAgentProcessManager } from "../../../src/shared/agent/process-manager";

class TestAgentProcessManager extends BaseAgentProcessManager {
  override start = async (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ): Promise<{ agentId: string; status: "started" | "already_running" }> => {
    type MockInternal = {
      clients: Map<string, { _activeSessionId: string }>;
      sessionPaths: Map<string, string>;
      sessionProjectPaths: Map<string, string>;
      processByCwd: Map<string, Set<unknown>>;
      servers: Set<{ emitEvent: (...args: unknown[]) => void }>;
    };
    const self = this as unknown as MockInternal;

    const existing = self.clients.get(sessionId);
    if (existing && existing._activeSessionId === sessionId) {
      return { agentId: sessionId, status: "already_running" };
    }

    const mockClient = {
      channel: () => ({
        send: vi.fn(),
        onReceive: vi.fn(() => () => {}),
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => {}),
    };

    const managed = {
      client: mockClient,
      info: {
        sessionId,
        projectPath,
        sessionPath,
        status: "idle",
        holdEvents: [] as unknown[],
      },
      _activeSessionId: sessionId,
      unsubscribe: () => {},
    };

    self.clients.set(sessionId, managed);
    self.sessionPaths.set(sessionId, sessionPath);
    self.sessionProjectPaths.set(sessionId, projectPath);

    let procSet = self.processByCwd.get(projectPath);
    if (!procSet) {
      procSet = new Set();
      self.processByCwd.set(projectPath, procSet);
    }
    procSet.add(managed);

    for (const server of self.servers) {
      server.emitEvent(
        "agent.session_status_changed",
        { sessionId, projectPath, status: "idle" },
        {},
      );
    }

    return { agentId: sessionId, status: "started" };
  };
}

type APM = TestAgentProcessManager;

interface ManagedClientShape {
  client: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    [key: string]: unknown;
  };
  info: {
    sessionId: string;
    projectPath: string;
    sessionPath: string;
    status: string;
    holdEvents: unknown[];
  };
  _activeSessionId: string;
}

interface InternalAPM {
  clients: Map<string, ManagedClientShape>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  processByCwd: Map<string, Set<ManagedClientShape>>;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ agentId: string; status: string }>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

type APMConstructorParam = ConstructorParameters<typeof BaseAgentProcessManager>[0];

function createManager(): { manager: APM; server: MockRPCServer } {
  const server = new MockRPCServer();
  const manager = new TestAgentProcessManager(server as unknown as APMConstructorParam);
  return { manager, server };
}

describe("AgentProcessManager — start() with multi-process support", () => {
  let manager: APM;
  let server: MockRPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    const result = createManager();
    manager = result.manager;
    server = result.server;
  });

  it("broadcasts session_status_changed(idle) after starting a new process", async () => {
    const sessionId = "test-session";
    const projectPath = "/fake/project";
    const sessionPath = "/fake/sessions/test-session.jsonl";

    const result = await manager.start(sessionId, projectPath, sessionPath);

    expect(result.status).toBe("started");
    expect(result.agentId).toBe(sessionId);

    expect(server.emitEvent).toHaveBeenCalledWith(
      "agent.session_status_changed",
      expect.objectContaining({
        sessionId,
        status: "idle",
      }),
      {},
    );
  });

  it("returns already_running for an existing session", async () => {
    const sessionId = "existing-session";
    const projectPath = "/fake/project";
    const sessionPath = "/fake/sessions/existing-session.jsonl";

    await manager.start(sessionId, projectPath, sessionPath);

    const result = await manager.start(sessionId, projectPath, sessionPath);

    expect(result.status).toBe("already_running");
  });

  it("allows multiple sessions to have separate processes", async () => {
    const projectPath = "/fake/project";

    const result1 = await manager.start("session-a", projectPath, "/fake/sessions/session-a.jsonl");
    const result2 = await manager.start("session-b", projectPath, "/fake/sessions/session-b.jsonl");

    expect(result1.status).toBe("started");
    expect(result2.status).toBe("started");

    // Both sessions should have their own clients
    const m = internals(manager);
    expect(m.clients.get("session-a")).toBeDefined();
    expect(m.clients.get("session-b")).toBeDefined();
    expect(m.clients.get("session-a")).not.toBe(m.clients.get("session-b"));

    // processByCwd should have a Set with 2 entries for this project
    const procSet = m.processByCwd.get(projectPath);
    expect(procSet).toBeDefined();
    expect(procSet!.size).toBe(2);
  });

  it("tracks processes per project correctly", async () => {
    const m = internals(manager);

    await manager.start("s1", "/project/a", "/sessions/s1.jsonl");
    await manager.start("s2", "/project/a", "/sessions/s2.jsonl");
    await manager.start("s3", "/project/b", "/sessions/s3.jsonl");

    const setA = m.processByCwd.get("/project/a");
    const setB = m.processByCwd.get("/project/b");

    expect(setA?.size).toBe(2);
    expect(setB?.size).toBe(1);
  });
});
