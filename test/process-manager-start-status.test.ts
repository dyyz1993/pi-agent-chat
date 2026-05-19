/**
 * @vitest-environment node
 *
 * Unit tests for AgentProcessManager start() — broadcastSessionStatus after
 * a successful switchSession.  Verifies that an "agent.session_status_changed"
 * event with status "idle" is broadcast when the pool reuses an existing process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { AgentProcessManager as APM } from "../src/shared/agent/process-manager";
import { AgentProcessManager } from "../src/shared/agent/process-manager";

interface ManagedClientShape {
  client: {
    channel: () => {
      send: (data: unknown) => void;
      onReceive: (handler: (data: unknown) => void) => () => void;
      invoke: (data: unknown) => Promise<unknown>;
      call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    };
    prompt: (content: string) => Promise<void>;
    steer: (content: string) => Promise<void>;
    followUp: (content: string) => Promise<void>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    switchSession: (path: string) => Promise<{ cancelled: boolean }>;
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
  processByCwd: Map<string, ManagedClientShape>;
  handleCoordinatorDelegateSend: (msg: Record<string, unknown>) => Promise<{
    delivered: boolean;
    targetStatus: string;
  }>;
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

type APMConstructorParam = ConstructorParameters<typeof AgentProcessManager>[0];

function createManager(): { manager: APM; server: MockRPCServer } {
  const server = new MockRPCServer();
  const manager = new AgentProcessManager(server as unknown as APMConstructorParam);
  return { manager, server };
}

function makeMockManaged(overrides: Record<string, unknown> = {}): ManagedClientShape {
  const sid = (overrides.sessionId as string) ?? "test-session";
  return {
    client: {
      channel: () => ({
        send: vi.fn(),
        onReceive: vi.fn(() => () => {}),
        invoke: vi.fn(),
        call: vi.fn(),
      }),
      prompt: vi.fn().mockResolvedValue(undefined),
      steer: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue(undefined),
      switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
    },
    info: {
      sessionId: sid,
      projectPath: (overrides.projectPath as string) ?? "/fake/project",
      sessionPath: (overrides.sessionPath as string) ?? `/fake/sessions/${sid}.jsonl`,
      status: (overrides.status as string) ?? "idle",
      holdEvents: [],
    },
    _activeSessionId: sid,
  };
}

describe("AgentProcessManager — start() broadcasts session_status_changed", () => {
  let manager: APM;
  let server: MockRPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    const result = createManager();
    manager = result.manager;
    server = result.server;
  });

  it("broadcasts session_status_changed(idle) after switchSession succeeds", async () => {
    const oldSessionId = "old-session";
    const newSessionId = "new-session";
    const projectPath = "/fake/project";
    const oldSessionPath = `/fake/sessions/${oldSessionId}.jsonl`;
    const newSessionPath = `/fake/sessions/${newSessionId}.jsonl`;

    const mockManaged = makeMockManaged({ sessionId: oldSessionId, projectPath });

    const m = internals(manager);
    m.clients.set(oldSessionId, mockManaged);
    m.processByCwd.set(projectPath, mockManaged);
    m.sessionPaths.set(oldSessionId, oldSessionPath);
    m.sessionProjectPaths.set(oldSessionId, projectPath);

    const result = await manager.start(newSessionId, projectPath, newSessionPath);

    expect(result.status).toBe("switched");

    expect(server.emitEvent).toHaveBeenCalledWith(
      "agent.session_status_changed",
      expect.objectContaining({
        sessionId: newSessionId,
        status: "idle",
      }),
      {},
    );
  });

  it("broadcasts session_status_changed with projectPath from managed client", async () => {
    const oldSessionId = "old-session-2";
    const newSessionId = "new-session-2";
    const projectPath = "/fake/project-2";
    const oldSessionPath = `/fake/sessions/${oldSessionId}.jsonl`;
    const newSessionPath = `/fake/sessions/${newSessionId}.jsonl`;

    const mockManaged = makeMockManaged({ sessionId: oldSessionId, projectPath });

    const m = internals(manager);
    m.clients.set(oldSessionId, mockManaged);
    m.processByCwd.set(projectPath, mockManaged);
    m.sessionPaths.set(oldSessionId, oldSessionPath);
    m.sessionProjectPaths.set(oldSessionId, projectPath);

    await manager.start(newSessionId, projectPath, newSessionPath);

    expect(server.emitEvent).toHaveBeenCalledWith(
      "agent.session_status_changed",
      { sessionId: newSessionId, projectPath, status: "idle" },
      {},
    );
  });

  it("does not broadcast session_status_changed when switchSession is cancelled", async () => {
    const oldSessionId = "old-session-3";
    const newSessionId = "new-session-3";
    const projectPath = "/fake/project-3";
    const oldSessionPath = `/fake/sessions/${oldSessionId}.jsonl`;
    const newSessionPath = `/fake/sessions/${newSessionId}.jsonl`;

    const mockManaged = makeMockManaged({ sessionId: oldSessionId, projectPath });
    mockManaged.client.switchSession = vi.fn().mockResolvedValue({ cancelled: true });

    const m = internals(manager);
    m.clients.set(oldSessionId, mockManaged);
    m.processByCwd.set(projectPath, mockManaged);
    m.sessionPaths.set(oldSessionId, oldSessionPath);
    m.sessionProjectPaths.set(oldSessionId, projectPath);

    await expect(manager.start(newSessionId, projectPath, newSessionPath)).rejects.toThrow();

    expect(server.emitEvent).not.toHaveBeenCalledWith(
      "agent.session_status_changed",
      expect.anything(),
      expect.anything(),
    );
  });
});
