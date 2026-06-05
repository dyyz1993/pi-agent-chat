/**
 * @vitest-environment node
 *
 * Verifies that AgentProcessManager.send() owns stale-session recovery.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

vi.mock("../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
    sandboxEnabled: false,
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
    prompt: (content: string, images?: unknown[]) => Promise<void>;
    switchSession?: (sessionPath: string) => Promise<{ cancelled: boolean }>;
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
  _startInProgress: boolean;
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

function makeManaged(sessionId: string, projectPath: string, sessionPath: string): ManagedClientShape {
  return {
    client: {
      prompt: vi.fn().mockResolvedValue(undefined),
      switchSession: vi.fn().mockResolvedValue({ cancelled: false }),
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("AgentProcessManager.send stale-session recovery", () => {
  let manager: APM;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("rebuilds from disk session scanner when manager metadata is missing", async () => {
    const sessionId = "sess_coord_after_restart";
    const projectPath = join(tmpdir(), `pi-send-recovery-project-${Date.now()}`);
    const sessionRoot = join(homedir(), ".pi", "agent", "sessions", `send-recovery-${Date.now()}`);
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

    const managed = makeManaged(sessionId, projectPath, sessionPath);
    const startSpy = vi.spyOn(manager, "start").mockImplementation(async () => {
      m.clients.set(sessionId, managed);
      return { agentId: sessionId, status: "started" };
    });

    const ok = await manager.send(sessionId, "hello after restart");

    expect(ok).toBe(true);
    expect(startSpy).toHaveBeenCalledWith(
      sessionId,
      projectPath,
      sessionPath,
      expect.objectContaining({ forceNewProcess: false }),
    );
    expect(m.sessionProjectPaths.get(sessionId)).toBe(projectPath);
    expect(m.sessionPaths.get(sessionId)).toBe(sessionPath);
    expect(managed.client.prompt).toHaveBeenCalledWith("hello after restart", undefined);
    rmSync(sessionRoot, { recursive: true, force: true });
    rmSync(projectPath, { recursive: true, force: true });
  });

  it("returns false when no active client or session metadata exists", async () => {
    const ok = await manager.send("missing-session", "hello");

    expect(ok).toBe(false);
  });

  it("releases the start lock after switching a pooled process", async () => {
    const projectPath = "/fake/project";
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

    expect(first.status).toBe("switched");
    expect(second.status).toBe("switched");
    expect(m._startInProgress).toBe(false);
    expect(m.clients.has(oldSessionId)).toBe(false);
    expect(m.clients.has(newSessionId)).toBe(false);
    expect(m.clients.get(thirdSessionId)).toBe(pooled);
    expect(pooled.client.switchSession).toHaveBeenCalledTimes(2);
  });

  it("queues concurrent starts instead of reporting a missing session as already running", async () => {
    const projectPath = "/fake/project";
    const oldSessionId = "session-old";
    const firstSessionId = "session-first";
    const secondSessionId = "session-second";
    const oldSessionPath = "/fake/sessions/session-old.jsonl";
    const firstSessionPath = "/fake/sessions/session-first.jsonl";
    const secondSessionPath = "/fake/sessions/session-second.jsonl";
    const firstSwitch = deferred<{ cancelled: boolean }>();
    const m = internals(manager);
    const pooled = makeManaged(oldSessionId, projectPath, oldSessionPath);
    const switchSession = vi
      .fn()
      .mockReturnValueOnce(firstSwitch.promise)
      .mockResolvedValue({ cancelled: false });
    pooled.client.switchSession = switchSession;

    m.clients.set(oldSessionId, pooled);
    m.processByCwd.set(projectPath, new Set([pooled]));

    const firstStart = manager.start(firstSessionId, projectPath, firstSessionPath);
    await Promise.resolve();
    expect(switchSession).toHaveBeenCalledTimes(1);

    const secondStart = manager.start(secondSessionId, projectPath, secondSessionPath);
    firstSwitch.resolve({ cancelled: false });

    const first = await firstStart;
    const second = await secondStart;

    expect(first.status).toBe("switched");
    expect(second.status).toBe("switched");
    expect(switchSession).toHaveBeenNthCalledWith(1, firstSessionPath);
    expect(switchSession).toHaveBeenNthCalledWith(2, secondSessionPath);
    expect(m.clients.has(firstSessionId)).toBe(false);
    expect(m.clients.get(secondSessionId)).toBe(pooled);
    expect(m._startInProgress).toBe(false);
  });
});
