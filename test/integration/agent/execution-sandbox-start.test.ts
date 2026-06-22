/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rpcClientConstructors = vi.hoisted(() => [] as Array<Record<string, unknown> | undefined>);

vi.mock("@dyyz1993/pi-coding-agent", () => {
  class MockRpcClient {
    options: Record<string, unknown> | undefined;

    constructor(options?: Record<string, unknown>) {
      this.options = options;
      rpcClientConstructors.push(options);
    }

    async start() {}
    async stop() {}
    onEvent() {
      return () => {};
    }
    channel() {
      return { onReceive: () => () => {} };
    }
  }

  return { RpcClient: MockRpcClient };
});

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/bin/echo",
    piExtensionsDir: "/tmp/pi-agent-chat-test-missing-extensions",
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

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";
import { writeProjectExecutionSandbox } from "../../../src/shared/lib/execution-sandbox-config";

let oldAgentDir: string | undefined;
let tempRoot: string;

beforeEach(async () => {
  oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  tempRoot = await mkdtemp(join(tmpdir(), "pi-agent-start-sandbox-test-"));
  process.env.PI_CODING_AGENT_DIR = join(tempRoot, "agent");
  rpcClientConstructors.length = 0;
});

afterEach(async () => {
  if (oldAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

function makeServer() {
  return {
    emitEvent: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AgentProcessManager execution sandbox start env", () => {
  it("passes PI_SANDBOX_RUNTIME to new agent processes for filesystem mode", async () => {
    const projectPath = join(tempRoot, "project");
    await mkdir(projectPath, { recursive: true });
    writeProjectExecutionSandbox(projectPath, "filesystem");

    const manager = new AgentProcessManager(makeServer() as never);
    await manager.start("session-1", projectPath, join(tempRoot, "session-1.jsonl"), {
      forceNewProcess: true,
    });

    expect(rpcClientConstructors).toHaveLength(1);
    expect(rpcClientConstructors[0]?.env).toMatchObject({
      PI_SANDBOX_RUNTIME: "1",
      NODE_OPTIONS: "--max-old-space-size=8192",
      PI_SKIP_MCP: "1",
    });
  });

  it("removes PI_SANDBOX_RUNTIME for off mode", async () => {
    process.env.PI_SANDBOX_RUNTIME = "1";
    const projectPath = join(tempRoot, "project");
    await mkdir(projectPath, { recursive: true });
    writeProjectExecutionSandbox(projectPath, "off");

    const manager = new AgentProcessManager(makeServer() as never);
    await manager.start("session-1", projectPath, join(tempRoot, "session-1.jsonl"), {
      forceNewProcess: true,
    });

    expect(rpcClientConstructors).toHaveLength(1);
    expect(
      (rpcClientConstructors[0]?.env as Record<string, string>).PI_SANDBOX_RUNTIME,
    ).toBeUndefined();
  });
});
