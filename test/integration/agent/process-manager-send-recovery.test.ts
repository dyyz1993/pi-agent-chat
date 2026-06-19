/**
 * @vitest-environment node
 *
 * Verifies that AgentProcessManager.send() owns stale-session recovery.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

const rpcClientMockState = vi.hoisted(() => ({
  instances: [] as Array<{ start: ReturnType<typeof vi.fn> }>,
  startMode: "immediate" as "immediate" | "deferred",
  startResolvers: [] as Array<() => void>,
}));

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/Users/xuyingzhou/Project/temporary/pi-agent-chat/.yalc/@dyyz1993/pi-coding-agent/dist/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
    sandboxEnabled: true,
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
  RpcClient: class {
    start = vi.fn(() => {
      if (rpcClientMockState.startMode === "deferred") {
        return new Promise<void>((resolve) => {
          rpcClientMockState.startResolvers.push(resolve);
        });
      }
      return Promise.resolve();
    });
    stop = vi.fn().mockResolvedValue(undefined);
    prompt = vi.fn().mockResolvedValue(undefined);
    onEvent = vi.fn().mockReturnValue(vi.fn());
    channel = vi.fn().mockReturnValue({ onReceive: vi.fn() });

    constructor() {
      rpcClientMockState.instances.push(this);
    }
  },
}));

import type { AgentProcessManager as APM } from "../../../src/shared/agent/process-manager";
import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

interface ManagedClientShape {
  client: {
    prompt: (content: string, images?: unknown[]) => Promise<void>;
    stop?: () => Promise<void>;
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
  processByCwd: Map<string, Set<ManagedClientShape>>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

function createManager(): APM {
  return new AgentProcessManager(new MockRPCServer() as never);
}

function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
}

function makeManaged(sessionId: string, projectPath: string, sessionPath: string): ManagedClientShape {
  return {
    client: {
      prompt: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    },
    info: {
      sessionId,
      projectPath,
      sessionPath,
      status: "idle",
      holdEvents: [],
    },
    unsubscribe: () => {},
    _activeSessionId: sessionId,
    lastActiveAt: Date.now(),
    activeBackgroundTools: new Set(),
  };
}

describe("AgentProcessManager.send stale-session recovery", () => {
  let manager: APM;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcClientMockState.instances.length = 0;
    rpcClientMockState.startMode = "immediate";
    rpcClientMockState.startResolvers.length = 0;
    manager = createManager();
  });

  it("rebuilds from persisted manager metadata before sending", async () => {
    const sessionId = "sess_coord_stale";
    const projectPath = "/fake/project";
    const sessionPath = "/fake/sessions/sess_coord_stale.jsonl";
    const m = internals(manager);
    m.sessionProjectPaths.set(sessionId, projectPath);
    m.sessionPaths.set(sessionId, sessionPath);

    const managed = makeManaged(sessionId, projectPath, sessionPath);
    const startSpy = vi.spyOn(manager, "start").mockImplementation(async () => {
      m.clients.set(sessionId, managed);
      return { agentId: sessionId, status: "started" };
    });

    const ok = await manager.send(sessionId, "hello");

    expect(ok).toBe(true);
    expect(startSpy).toHaveBeenCalledWith(
      sessionId,
      projectPath,
      sessionPath,
      expect.objectContaining({ forceNewProcess: false }),
    );
    expect(managed.client.prompt).toHaveBeenCalledWith("hello", undefined);
  });

  it("returns false when only disk session data exists without manager metadata", async () => {
    const sessionId = "sess_coord_after_restart";
    const projectPath = join(tmpdir(), `pi-send-recovery-project-${Date.now()}`);
    const sessionRoot = join(homedir(), ".pi", "agent", "sessions", encodeCwd(projectPath));
    const sessionPath = join(sessionRoot, `${sessionId}.jsonl`);
    const m = internals(manager);
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(sessionRoot, { recursive: true });
    writeFileSync(
      sessionPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        timestamp: "2026-06-05T00:00:00.000Z",
        cwd: projectPath,
      }) + "\n",
      "utf-8",
    );

    const startSpy = vi.spyOn(manager, "start");

    const ok = await manager.send(sessionId, "hello after restart");

    expect(ok).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
    expect(m.sessionProjectPaths.get(sessionId)).toBeUndefined();
    expect(m.sessionPaths.get(sessionId)).toBeUndefined();
    rmSync(sessionRoot, { recursive: true, force: true });
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("returns false when no active client or session metadata exists", async () => {
    const ok = await manager.send("missing-session", "hello");

    expect(ok).toBe(false);
  });

  it("starts independent clients without replacing pooled sessions", async () => {
    const projectPath = join(tmpdir(), `pi-start-lock-project-${Date.now()}`);
    const oldSessionId = "session-old";
    const newSessionId = "session-new";
    const thirdSessionId = "session-third";
    const oldSessionPath = "/fake/sessions/session-old.jsonl";
    const newSessionPath = "/fake/sessions/session-new.jsonl";
    const thirdSessionPath = "/fake/sessions/session-third.jsonl";
    const m = internals(manager);
    const pooled = makeManaged(oldSessionId, projectPath, oldSessionPath);

    m.clients.set(oldSessionId, pooled);
    m.processByCwd.set(projectPath, new Set([pooled]));

    const first = await manager.start(newSessionId, projectPath, newSessionPath);
    const second = await manager.start(thirdSessionId, projectPath, thirdSessionPath);

    expect(first.status).toBe("started");
    expect(second.status).toBe("started");
    expect(m.clients.get(oldSessionId)).toBe(pooled);
    expect(m.clients.has(newSessionId)).toBe(true);
    expect(m.clients.has(thirdSessionId)).toBe(true);
    expect(rpcClientMockState.instances).toHaveLength(2);
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("starts a separate client for each requested session", async () => {
    const projectPath = join(tmpdir(), `pi-separate-client-project-${Date.now()}`);
    const oldSessionId = "session-old";
    const firstSessionId = "session-first";
    const secondSessionId = "session-second";
    const oldSessionPath = "/fake/sessions/session-old.jsonl";
    const firstSessionPath = "/fake/sessions/session-first.jsonl";
    const secondSessionPath = "/fake/sessions/session-second.jsonl";
    const m = internals(manager);
    const pooled = makeManaged(oldSessionId, projectPath, oldSessionPath);

    m.clients.set(oldSessionId, pooled);
    m.processByCwd.set(projectPath, new Set([pooled]));

    const first = await manager.start(firstSessionId, projectPath, firstSessionPath);
    const second = await manager.start(secondSessionId, projectPath, secondSessionPath);

    expect(first.status).toBe("started");
    expect(second.status).toBe("started");
    expect(m.clients.get(oldSessionId)).toBe(pooled);
    expect(m.clients.has(firstSessionId)).toBe(true);
    expect(m.clients.has(secondSessionId)).toBe(true);
    expect(rpcClientMockState.instances).toHaveLength(2);
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("joins concurrent starts for the same session instead of spawning duplicates", async () => {
    const projectPath = join(tmpdir(), `pi-concurrent-start-project-${Date.now()}`);
    const sessionId = "session-concurrent";
    const sessionPath = "/fake/sessions/session-concurrent.jsonl";
    const m = internals(manager);
    rpcClientMockState.startMode = "deferred";

    const firstStart = manager.start(sessionId, projectPath, sessionPath);
    await vi.waitFor(() => {
      expect(rpcClientMockState.instances).toHaveLength(1);
    });

    const secondStart = manager.start(sessionId, projectPath, sessionPath);
    await Promise.resolve();

    expect(rpcClientMockState.instances).toHaveLength(1);
    rpcClientMockState.startResolvers[0]?.();

    await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([
      { agentId: sessionId, status: "started" },
      { agentId: sessionId, status: "started" },
    ]);
    expect(m.clients.has(sessionId)).toBe(true);
    rmSync(projectPath, { recursive: true, force: true });
  });
});
