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

function makeManaged(sessionId: string, projectPath: string, sessionPath: string): ManagedClientShape {
  return {
    client: {
      prompt: vi.fn().mockResolvedValue(undefined),
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
});
