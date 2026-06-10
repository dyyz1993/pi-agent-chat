/**
 * @vitest-environment node
 *
 * Unit tests for AgentProcessManager handleEvent session_info_changed.
 * Verifies that when the core agent emits session_info_changed, the process
 * manager broadcasts agent.session_renamed to all connected frontends.
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
    switchSession: (path: string) => Promise<{ cancelled: boolean }>;
    onEvent: (handler: (event: unknown) => void) => () => void;
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
  channelHandlers: {
    handleEvent: (sessionId: string, event: Record<string, unknown>) => void;
  };
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

function makeMockManaged(
  overrides: Record<string, unknown> = {},
): ManagedClientShape & { _capturedEventHandler: ((event: unknown) => void) | null } {
  const sid = (overrides.sessionId as string) ?? "test-session";

  const result: ManagedClientShape & { _capturedEventHandler: ((event: unknown) => void) | null } =
    {
      _capturedEventHandler: null,
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
        onEvent: vi.fn((handler: (event: unknown) => void) => {
          result._capturedEventHandler = handler;
          return () => {};
        }),
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

  return result;
}

describe("AgentProcessManager — session_info_changed event", () => {
  let manager: APM;
  let rpcServer: MockRPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcServer = new MockRPCServer();
    manager = new AgentProcessManager(rpcServer as never);
  });

  it("broadcasts agent.session_renamed when receiving session_info_changed", async () => {
    const sessionId = "sess-title-1";
    const managed = makeMockManaged({
      sessionId,
      projectPath: "/fake/project",
    });
    const m = internals(manager);
    m.clients.set(sessionId, managed);

    m.channelHandlers.handleEvent(sessionId, {
      type: "session_info_changed",
      name: "Auto Generated Title",
    });

    await vi.waitFor(() => {
      expect(rpcServer.emitEvent).toHaveBeenCalledWith(
        "agent.session_renamed",
        expect.objectContaining({
          sessionId,
          newName: "Auto Generated Title",
        }),
        expect.anything(),
      );
    });
  });

  it("includes projectPath in the broadcast payload", async () => {
    const sessionId = "sess-title-2";
    const managed = makeMockManaged({
      sessionId,
      projectPath: "/my/special/project",
    });
    const m = internals(manager);
    m.clients.set(sessionId, managed);

    m.channelHandlers.handleEvent(sessionId, {
      type: "session_info_changed",
      name: "Some Title",
    });

    await vi.waitFor(() => {
      expect(rpcServer.emitEvent).toHaveBeenCalledWith(
        "agent.session_renamed",
        expect.objectContaining({
          sessionId,
          projectPath: "/my/special/project",
          newName: "Some Title",
        }),
        expect.anything(),
      );
    });
  });

  it("ignores session_info_changed when name is empty string", () => {
    const sessionId = "sess-title-3";
    const managed = makeMockManaged({ sessionId });
    const m = internals(manager);
    m.clients.set(sessionId, managed);

    m.channelHandlers.handleEvent(sessionId, {
      type: "session_info_changed",
      name: "",
    });

    expect(rpcServer.emitEvent).not.toHaveBeenCalledWith(
      "agent.session_renamed",
      expect.anything(),
      expect.anything(),
    );
  });

  it("ignores session_info_changed when name is not a string", () => {
    const sessionId = "sess-title-4";
    const managed = makeMockManaged({ sessionId });
    const m = internals(manager);
    m.clients.set(sessionId, managed);

    m.channelHandlers.handleEvent(sessionId, {
      type: "session_info_changed",
      name: 12345,
    });

    expect(rpcServer.emitEvent).not.toHaveBeenCalledWith(
      "agent.session_renamed",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not drop session_info_changed when session is idle", async () => {
    const sessionId = "sess-idle";
    const managed = makeMockManaged({
      sessionId,
      status: "idle",
    });
    const m = internals(manager);
    m.clients.set(sessionId, managed);

    m.channelHandlers.handleEvent(sessionId, {
      type: "session_info_changed",
      name: "Idle Title Update",
    });

    await vi.waitFor(() => {
      expect(rpcServer.emitEvent).toHaveBeenCalledWith(
        "agent.session_renamed",
        expect.objectContaining({
          sessionId,
          newName: "Idle Title Update",
        }),
        expect.anything(),
      );
    });
  });
});
