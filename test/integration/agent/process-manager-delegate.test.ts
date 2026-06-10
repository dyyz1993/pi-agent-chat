/**
 * @vitest-environment node
 *
 * TDD tests for two delegate validation bugs:
 *
 * BUG-1: handleCoordinatorDelegateStatus returns "stopped" for a
 *         sessionId that never existed. Expected: "not_found".
 *
 * BUG-2: handleCoordinatorDelegateFork ignores msg.sessionId and always
 *         forks from parentSessionId, so a non-existent target never errors.
 *         Expected: throw when target session is not found.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──
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

// ── Internal type for accessing private members in tests ──
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
  processByCwd: Map<string, Set<ManagedClientShape>>;
  parentChildMap: Map<string, Set<string>>;
  handleCoordinatorDelegateStatus: (msg: Record<string, unknown>) => Promise<{
    status: string;
    isCompacting: boolean;
    contextUsage: unknown;
  }>;
  handleCoordinatorDelegateFork: (
    parentSessionId: string,
    msg: Record<string, unknown>,
  ) => Promise<{ sessionId: string; status: "started" | "already_running" }>;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ agentId: string; status: string }>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

// Mock RPCServer for the constructor
class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Helpers ──

function createManager(): APM {
  return new AgentProcessManager(new MockRPCServer() as never);
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
    unsubscribe: vi.fn(),
  } as unknown as ManagedClientShape;
}

const TMP_DIR = join(tmpdir(), "pi-test-delegate-validation");

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure clean temp dir
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
});

// ════════════════════════════════════════════════════════════════
// BUG-1: session_delegate_status for non-existent sessionId
// ════════════════════════════════════════════════════════════════
describe("BUG-1: handleCoordinatorDelegateStatus — non-existent sessionId", () => {
  it("returns 'stopped' for a sessionId that was never created (BUG)", async () => {
    const manager = createManager();
    const m = internals(manager);

    // No session registered at all — this ID never existed
    const msg = {
      __call: "session_delegate_status" as const,
      sessionId: "sess_ghost_never_existed_99999",
      invokeId: "inv_bug1",
    };

    // BEFORE FIX: returns { status: "stopped" } — misleading
    // AFTER FIX:  should return { status: "not_found" }
    const result = await m.handleCoordinatorDelegateStatus(msg);

    expect(result.status).toBe("not_found");
  });

  it("returns 'stopped' for a session that existed but is no longer active", async () => {
    const manager = createManager();
    const m = internals(manager);

    const sid = "sess_was_real_but_stopped";
    const realPath = join(TMP_DIR, `${sid}.jsonl`);
    writeFileSync(
      realPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: sid,
        timestamp: new Date().toISOString(),
        cwd: "/fake/project",
      }) + "\n",
      "utf-8",
    );

    // Register in sessionPaths (session existed) but NOT in clients (not active)
    m.sessionPaths.set(sid, realPath);
    m.sessionProjectPaths.set(sid, "/fake/project");

    const msg = {
      __call: "session_delegate_status" as const,
      sessionId: sid,
      invokeId: "inv_real_stopped",
    };

    // This session DID exist — should still return "stopped"
    const result = await m.handleCoordinatorDelegateStatus(msg);
    expect(result.status).toBe("stopped");
  });

  it("does not confuse a non-existent session with a stopped-but-real one", async () => {
    const manager = createManager();
    const m = internals(manager);

    // Register one real stopped session
    const realStopped = "sess_real_stopped";
    const realPath = join(TMP_DIR, `${realStopped}.jsonl`);
    writeFileSync(
      realPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: realStopped,
        timestamp: new Date().toISOString(),
        cwd: "/fake/project",
      }) + "\n",
      "utf-8",
    );
    m.sessionPaths.set(realStopped, realPath);
    m.sessionProjectPaths.set(realStopped, "/fake/project");

    // Query the non-existent one — must NOT get "stopped"
    const ghost = "sess_totally_ghost_88888";
    const msg = {
      __call: "session_delegate_status" as const,
      sessionId: ghost,
      invokeId: "inv_ghost2",
    };

    const result = await m.handleCoordinatorDelegateStatus(msg);
    expect(result.status).toBe("not_found");

    // Query the real stopped one — must get "stopped"
    const msg2 = {
      __call: "session_delegate_status" as const,
      sessionId: realStopped,
      invokeId: "inv_real2",
    };
    const result2 = await m.handleCoordinatorDelegateStatus(msg2);
    expect(result2.status).toBe("stopped");
  });
});

// ════════════════════════════════════════════════════════════════
// BUG-2: session_delegate_fork ignores msg.sessionId
// ════════════════════════════════════════════════════════════════
describe("BUG-2: handleCoordinatorDelegateFork — non-existent target sessionId", () => {
  it("throws when msg.sessionId points to a non-existent session", async () => {
    const manager = createManager();
    const m = internals(manager);

    // The parent (caller) is active
    const parentSid = "sess_parent_caller";
    const parentPath = join(TMP_DIR, `${parentSid}.jsonl`);
    writeFileSync(
      parentPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: parentSid,
        timestamp: new Date().toISOString(),
        cwd: TMP_DIR,
      }) + "\n",
      "utf-8",
    );
    const parentManaged = makeMockManaged({
      sessionId: parentSid,
      sessionPath: parentPath,
      projectPath: TMP_DIR,
    });
    m.clients.set(parentSid, parentManaged);
    m.sessionPaths.set(parentSid, parentPath);

    // But the target in msg.sessionId does NOT exist in any map
    const ghostSid = "sess_ghost_fork_target_99999";
    const msg = {
      __call: "session_delegate_fork" as const,
      sessionId: ghostSid,
      task: "do something",
      title: "ghost fork",
      invokeId: "inv_bug2",
    };

    // BEFORE FIX: silently forks parent's session (msg.sessionId ignored)
    // AFTER FIX:  should throw because target session not found
    await expect(m.handleCoordinatorDelegateFork(parentSid, msg)).rejects.toThrow(/not found/i);
  });

  it("forks successfully when msg.sessionId points to an active session", async () => {
    const manager = createManager();
    const m = internals(manager);

    const parentSid = "sess_parent_real";
    const targetSid = "sess_target_real";

    // Both parent and target are in clients
    const targetPath = join(TMP_DIR, `${targetSid}.jsonl`);
    writeFileSync(
      targetPath,
      JSON.stringify({
        type: "session",
        version: 3,
        id: targetSid,
        timestamp: new Date().toISOString(),
        cwd: TMP_DIR,
      }) + "\n",
      "utf-8",
    );

    const parentManaged = makeMockManaged({
      sessionId: parentSid,
      sessionPath: join(TMP_DIR, `${parentSid}.jsonl`),
      projectPath: TMP_DIR,
    });
    const targetManaged = makeMockManaged({
      sessionId: targetSid,
      sessionPath: targetPath,
      projectPath: TMP_DIR,
    });
    m.clients.set(parentSid, parentManaged);
    m.clients.set(targetSid, targetManaged);
    m.sessionPaths.set(parentSid, join(TMP_DIR, `${parentSid}.jsonl`));
    m.sessionPaths.set(targetSid, targetPath);

    // Mock start to avoid real process spawning
    vi.spyOn(m, "start").mockResolvedValue({ agentId: "agent_fork", status: "idle" });

    const msg = {
      __call: "session_delegate_fork" as const,
      sessionId: targetSid,
      task: "fork this session",
      title: "legit fork",
      invokeId: "inv_good_fork",
    };

    const result = await m.handleCoordinatorDelegateFork(parentSid, msg);
    expect(result.sessionId).toMatch(/^sess_fork_/);
    expect(result.status).toBe("idle");
  });
});
