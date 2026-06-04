/**
 * @vitest-environment node
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
    send: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
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
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

function makeManaged(models: Record<string, string | undefined>): ManagedClientShape {
  return {
    client: {
      send: vi.fn().mockResolvedValue({ data: { models } }),
      setModel: vi.fn().mockResolvedValue({ provider: "zhipuai", id: "glm-5.1" }),
    },
    info: {
      sessionId: "sess-1",
      projectPath: "/fake/project",
      sessionPath: "/fake/sessions/sess-1.jsonl",
      status: "idle",
      holdEvents: [],
    },
    _activeSessionId: "sess-1",
  };
}

describe("AgentProcessManager.switchTier", () => {
  let manager: APM;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AgentProcessManager(
      new MockRPCServer() as unknown as Parameters<typeof AgentProcessManager>[0],
    );
  });

  it("resolves tier model mapping on the backend before calling setModel", async () => {
    const managed = makeManaged({
      fast: "zhipuai/glm-4.5-air",
      pro: "zhipuai/glm-5.1",
      max: "zhipuai/glm-5.1-thinking",
    });
    internals(manager).clients.set("sess-1", managed);

    await expect(manager.switchTier("sess-1", "pro")).resolves.toEqual({
      provider: "zhipuai",
      id: "glm-5.1",
      tier: "pro",
    });

    expect(managed.client.send).toHaveBeenCalledWith({ type: "get_tier_models" });
    expect(managed.client.setModel).toHaveBeenCalledWith("zhipuai", "glm-5.1");
  });

  it("rejects missing tier config without calling setModel", async () => {
    const managed = makeManaged({});
    internals(manager).clients.set("sess-1", managed);

    await expect(manager.switchTier("sess-1", "pro")).rejects.toThrow(
      'Tier "pro" is not configured',
    );

    expect(managed.client.setModel).not.toHaveBeenCalled();
  });

  it("rejects malformed tier mapping without calling setModel", async () => {
    const managed = makeManaged({ pro: "pro" });
    internals(manager).clients.set("sess-1", managed);

    await expect(manager.switchTier("sess-1", "pro")).rejects.toThrow(
      "Invalid tier model mapping: pro -> pro",
    );

    expect(managed.client.setModel).not.toHaveBeenCalled();
  });

  it("rejects invalid tiers before reading model config", async () => {
    const managed = makeManaged({ pro: "zhipuai/glm-5.1" });
    internals(manager).clients.set("sess-1", managed);

    await expect(manager.switchTier("sess-1", "slow" as never)).rejects.toThrow(
      'Invalid tier "slow". Valid tiers are: fast, pro, max',
    );

    expect(managed.client.send).not.toHaveBeenCalled();
    expect(managed.client.setModel).not.toHaveBeenCalled();
  });
});
