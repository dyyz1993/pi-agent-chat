/**
 * @vitest-environment node
 *
 * TDD test for bug: handleCoordinatorDelegateFork does NOT broadcast
 * coordinator.session_created after creating a forked session.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

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

import type { AgentProcessManager as APM } from "../../../src/shared/agent/process-manager";
import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

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
    setSessionName: (name: string) => Promise<void>;
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
  parentChildMap: Map<string, Set<string>>;
  handleCoordinatorDelegateFork: (
    parentSessionId: string,
    msg: Record<string, unknown>,
  ) => Promise<{ sessionId: string; status: string }>;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: { forceNewProcess?: boolean },
  ) => Promise<{ agentId: string; status: string }>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmpDir = join(tmpdir(), "pi-test-fork-broadcast");

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
      setSessionName: vi.fn().mockResolvedValue(undefined),
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

describe("AgentProcessManager — coordinator fork broadcast", () => {
  let manager: APM;
  let mockServer: MockRPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = new MockRPCServer();
    manager = new AgentProcessManager(mockServer as never);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("broadcasts coordinator.session_created after forking a session", async () => {
    const parentId = "parent-session-1";
    const projectPath = "/fake/project";
    const sessionPath = join(tmpDir, "parent-session-1.jsonl");

    writeFileSync(
      sessionPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: parentId,
        timestamp: "2025-01-01T00:00:00.000Z",
        cwd: projectPath,
      }) + "\n",
      "utf-8",
    );

    const parentManaged = makeMockManaged({
      sessionId: parentId,
      projectPath,
      sessionPath,
    });
    const m = internals(manager);
    m.clients.set(parentId, parentManaged);

    vi.spyOn(manager, "start").mockImplementation(async (sid: string, pp: string, sp: string) => {
      const mm = makeMockManaged({
        sessionId: sid,
        projectPath: pp,
        sessionPath: sp,
      });
      m.clients.set(sid, mm);
      return { agentId: sid, status: "started" };
    });

    const msg = {
      __call: "session_delegate_fork",
      sessionId: parentId,
      task: "fork task",
      title: "Fork Test",
    };

    const result = await m.handleCoordinatorDelegateFork(parentId, msg);

    expect(result.sessionId).toMatch(/^sess_fork_/);
    expect(result.status).toBe("started");

    expect(mockServer.emitEvent).toHaveBeenCalledWith(
      "coordinator.session_created",
      expect.objectContaining({
        parentSessionId: parentId,
        session: expect.objectContaining({
          sessionId: result.sessionId,
          parentSessionPath: sessionPath,
          projectPath,
          delegateParentSessionId: parentId,
          status: "running",
        }),
      }),
      { parentSessionId: parentId },
    );
  });
});
