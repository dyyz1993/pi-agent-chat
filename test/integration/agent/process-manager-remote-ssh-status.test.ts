/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
    sandboxEnabled: false,
    remoteChildShell: "sh -lc",
    remotePiAgentDir: "",
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

vi.mock("@dyyz1993/pi-coding-agent", () => ({
  AuthStorage: vi.fn(),
  ModelRegistry: vi.fn(),
}));

vi.mock("../../../src/shared/agent/remote-runtime-selection", () => ({
  resolveActiveRuntimeSelection: vi.fn(async () => ({
    kind: "remote-agent-child",
    source: "remote-project",
    remoteProject: {
      runtime: "ssh",
      sshRuntimeKind: "remote-agent-child",
      profileId: "profile-1",
      host: "xyz-mac",
      remotePath: "/Users/xyz/project",
      localPath: "/local/shadow/project",
    },
    target: "xyz-mac",
    remoteCwd: "/Users/xyz/project",
    shell: "sh -lc",
  })),
  buildRemoteChildSshArgs: vi.fn(() => ["-o", "BatchMode=yes"]),
  shouldCreateLocalRuntimeCwd: vi.fn(() => false),
}));

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

type ManagerInternals = {
  clients: Map<string, unknown>;
  processByCwd: Map<string, Set<unknown>>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
};

describe("AgentProcessManager remote SSH status", () => {
  it("broadcasts an error status when a remote child session is stopped after a crash", async () => {
    const server = new MockRPCServer();
    const manager = new AgentProcessManager(
      server as unknown as ConstructorParameters<typeof AgentProcessManager>[0],
    );
    const internals = manager as unknown as ManagerInternals;
    const sessionId = "sess-remote";
    const projectPath = "/local/shadow/project";
    const sessionPath = "/tmp/sess-remote.jsonl";
    const managed = {
      client: {
        getTreeWithLeaf: vi.fn().mockResolvedValue({ leafId: null }),
        stop: vi.fn().mockResolvedValue(undefined),
      },
      info: {
        sessionId,
        projectPath,
        sessionPath,
        status: "streaming",
        holdEvents: [],
      },
      _activeSessionId: sessionId,
      unsubscribe: vi.fn(),
    };

    internals.clients.set(sessionId, managed);
    internals.sessionPaths.set(sessionId, sessionPath);
    internals.sessionProjectPaths.set(sessionId, projectPath);
    internals.processByCwd.set(projectPath, new Set([managed]));

    await manager.stop(sessionId, "Agent process crashed");

    expect(server.emitEvent).toHaveBeenCalledWith(
      "agent.ssh_connection_changed",
      {
        sessionId,
        projectPath,
        status: expect.objectContaining({
          enabled: true,
          configured: true,
          status: "error",
          host: "xyz-mac",
          remoteCwd: "/Users/xyz/project",
          localCwd: projectPath,
          error: "Agent process crashed",
        }),
      },
      {},
    );
  });
});
