/**
 * @vitest-environment node
 *
 * TDD test for event name bug: process-manager uses "coordinator.session.event"
 * (dot) but the schema defines "coordinator.session_event" (underscore).
 * The RPC core does exact string matching, so the dot variant never reaches subscribers.
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
  parentChildMap: Map<string, Set<string>>;
  handleEvent: (sessionId: string, event: Record<string, unknown>) => void;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
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

describe("AgentProcessManager — event name consistency", () => {
  let manager: APM;
  let mockServer: MockRPCServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServer = new MockRPCServer();
    manager = new AgentProcessManager(
      mockServer as unknown as Parameters<typeof AgentProcessManager>[0],
    );
  });

  it("broadcasts coordinator.session_event (underscore) not coordinator.session.event (dot)", async () => {
    const parentId = "parent-session";
    const childId = "child-session";

    const m = internals(manager);
    const parentManaged = makeMockManaged({ sessionId: parentId });
    const childManaged = makeMockManaged({ sessionId: childId });

    m.clients.set(parentId, parentManaged);
    m.clients.set(childId, childManaged);

    m.parentChildMap.set(parentId, new Set([childId]));

    const event = { type: "agent_start" };
    m.handleEvent(childId, event);

    await vi.waitFor(() => {
      expect(mockServer.emitEvent).toHaveBeenCalled();
    });

    const calls = mockServer.emitEvent.mock.calls;
    const coordinatorCall = calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].startsWith("coordinator.session"),
    );

    expect(coordinatorCall).toBeDefined();
    expect(coordinatorCall![0]).toBe("coordinator.session_event");
    expect(coordinatorCall![0]).not.toBe("coordinator.session.event");
  });
});
