/**
 * @vitest-environment node
 *
 * Verifies AgentProcessManager.ensureManagedClient() uses the shared recovery
 * operation, including non-sandbox sessions recovered from disk metadata.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcClientMockState = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown> | undefined;
    start: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
  }>,
}));

const sessionScannerMockState = vi.hoisted(() => ({
  findSessionById: vi.fn(),
}));

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/pi-cli.js",
    piExtensionsDir: "/fake/extensions",
    sandboxEnabled: false,
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

vi.mock("../../../src/shared/lib/session-scanner", () => ({
  findSessionById: sessionScannerMockState.findSessionById,
}));

vi.mock("@dyyz1993/pi-coding-agent", () => ({
  RpcClient: class {
    options: Record<string, unknown> | undefined;
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    prompt = vi.fn().mockResolvedValue(undefined);
    onEvent = vi.fn().mockReturnValue(vi.fn());
    channel = vi.fn().mockReturnValue({ onReceive: vi.fn(), call: vi.fn() });

    constructor(options?: Record<string, unknown>) {
      this.options = options;
      rpcClientMockState.instances.push(this);
    }
  },
}));

import type { AgentProcessManager as APM } from "../../../src/shared/agent/process-manager";
import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

interface ManagedClientShape {
  client: {
    prompt: ReturnType<typeof vi.fn>;
  };
  info: {
    sessionId: string;
    projectPath: string;
    sessionPath: string;
    status: string;
    holdEvents: unknown[];
  };
  unsubscribe: () => void;
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
}

interface InternalAPM {
  clients: Map<string, ManagedClientShape>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

describe("AgentProcessManager ensureManagedClient integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcClientMockState.instances.length = 0;
  });

  it("rebuilds a non-sandbox session from disk metadata before sending", async () => {
    sessionScannerMockState.findSessionById.mockResolvedValueOnce({
      projectPath: "/fake/project",
      sessionPath: "/fake/sessions/sess-from-disk.jsonl",
    });
    const manager = new AgentProcessManager(new MockRPCServer() as never);
    const m = internals(manager);
    const managed: ManagedClientShape = {
      client: {
        prompt: vi.fn().mockResolvedValue(undefined),
      },
      info: {
        sessionId: "sess-from-disk",
        projectPath: "/fake/project",
        sessionPath: "/fake/sessions/sess-from-disk.jsonl",
        status: "idle",
        holdEvents: [],
      },
      unsubscribe: () => {},
      _activeSessionId: "sess-from-disk",
      lastActiveAt: 0,
      activeBackgroundTools: new Set(),
    };
    const startSpy = vi.spyOn(manager, "start").mockImplementation(async () => {
      m.clients.set("sess-from-disk", managed);
      return { agentId: "sess-from-disk", status: "started" };
    });

    const ok = await manager.send("sess-from-disk", "hello from recovered session");

    expect(ok).toBe(true);
    expect(sessionScannerMockState.findSessionById).toHaveBeenCalledWith("sess-from-disk");
    expect(startSpy).toHaveBeenCalledWith(
      "sess-from-disk",
      "/fake/project",
      "/fake/sessions/sess-from-disk.jsonl",
      expect.objectContaining({
        forceNewProcess: false,
      }),
    );
    expect(managed.client.prompt).toHaveBeenCalledWith("hello from recovered session", undefined);
  });
});
