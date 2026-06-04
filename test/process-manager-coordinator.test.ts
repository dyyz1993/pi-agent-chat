/**
 * @vitest-environment node
 *
 * Unit tests for AgentProcessManager coordinator delegate_send restart logic.
 * Uses type-narrowed accessors instead of `any` to comply with ESLint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──
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
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  processByCwd: Map<string, Set<ManagedClientShape>>;
  handleCoordinatorDelegateSend: (msg: Record<string, unknown>) => Promise<{
    delivered: boolean;
    targetStatus: string;
  }>;
  handleCoordinatorCall: (
    sessionId: string,
    msg: Record<string, unknown>,
    channelName?: string,
  ) => Promise<void>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPCServer interface is from external package
  return new AgentProcessManager(new MockRPCServer() as any);
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

describe("AgentProcessManager — coordinator delegate_send", () => {
  let manager: APM;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = createManager();
  });

  describe("handleCoordinatorDelegateSend restart logic", () => {
    it("delivers immediately when target session is active in clients Map", async () => {
      const targetId = "target-active";
      const mockManaged = makeMockManaged({ sessionId: targetId });
      const m = internals(manager);
      m.clients.set(targetId, mockManaged);
      m.sessionPaths.set(targetId, `/fake/sessions/${targetId}.jsonl`);
      m.sessionProjectPaths.set(targetId, "/fake/project");

      const msg = {
        __call: "session_delegate_send",
        invokeId: "inv_123",
        targetSessionId: targetId,
        message: "hello from delegate",
      };

      const result = await m.handleCoordinatorDelegateSend(msg);

      expect(result.delivered).toBe(true);
      expect(result.targetStatus).toBe("active");
    });

    it("restarts inactive session when file exists — then delivers", async () => {
      const targetId = "target-inactive";
      const projectPath = "/fake/project";

      // Create a real temp file so existsSync returns true
      const tmpDir = join(tmpdir(), "pi-test-coordinator");
      mkdirSync(tmpDir, { recursive: true });
      const realPath = join(tmpDir, "target-inactive.jsonl");
      writeFileSync(
        realPath,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "target-inactive",
          timestamp: "2025-01-01T00:00:00.000Z",
          cwd: "/fake/project",
        }) + "\n",
        "utf-8",
      );

      const m = internals(manager);
      m.sessionPaths.set(targetId, realPath);
      m.sessionProjectPaths.set(targetId, projectPath);

      // Mock start() to simulate restart
      const startSpy = vi
        .spyOn(manager, "start")
        .mockImplementation(async (sid: string, pp: string, sp: string) => {
          const mm = makeMockManaged({
            sessionId: sid,
            projectPath: pp,
            sessionPath: sp,
          });
          m.clients.set(sid, mm);
          return { agentId: sid, status: "started" };
        });

      const msg = {
        __call: "session_delegate_send",
        invokeId: "inv_456",
        targetSessionId: targetId,
        message: "reactivate me",
      };

      const result = await m.handleCoordinatorDelegateSend(msg);

      expect(startSpy).toHaveBeenCalledWith(targetId, projectPath, realPath);
      expect(result.delivered).toBe(true);
      expect(result.targetStatus).toBe("active");

      startSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns not_found when target session file does not exist on disk", async () => {
      const targetId = "target-gone";
      const projectPath = "/fake/project";
      const nonexistentPath = join(tmpdir(), "pi-test-nope", "nonexistent.jsonl");

      const m = internals(manager);
      m.sessionPaths.set(targetId, nonexistentPath);
      m.sessionProjectPaths.set(targetId, projectPath);

      const msg = {
        __call: "session_delegate_send",
        invokeId: "inv_789",
        targetSessionId: targetId,
        message: "to nowhere",
      };

      const result = await m.handleCoordinatorDelegateSend(msg);

      expect(result.delivered).toBe(false);
      expect(result.targetStatus).toBe("not_found");
    });

    it("returns not_found when session path is unknown (never started)", async () => {
      const msg = {
        __call: "session_delegate_send",
        invokeId: "inv_000",
        targetSessionId: "target-never-existed",
        message: "to phantom",
      };

      const result = await internals(manager).handleCoordinatorDelegateSend(msg);

      expect(result.delivered).toBe(false);
      expect(result.targetStatus).toBe("not_found");
    });

    it("returns not_found when restart throws an error", async () => {
      const targetId = "target-restart-fails";
      const projectPath = "/fake/project";

      const tmpDir = join(tmpdir(), "pi-test-coordinator-fail");
      mkdirSync(tmpDir, { recursive: true });
      const realPath = join(tmpDir, "target-restart-fails.jsonl");
      writeFileSync(
        realPath,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "target-restart-fails",
          timestamp: "2025-01-01T00:00:00.000Z",
          cwd: "/fake/project",
        }) + "\n",
        "utf-8",
      );

      const m = internals(manager);
      m.sessionPaths.set(targetId, realPath);
      m.sessionProjectPaths.set(targetId, projectPath);

      const startSpy = vi
        .spyOn(manager, "start")
        .mockRejectedValue(new Error("Cannot start process"));

      const msg = {
        __call: "session_delegate_send",
        invokeId: "inv_err",
        targetSessionId: targetId,
        message: "will fail",
      };

      const result = await m.handleCoordinatorDelegateSend(msg);

      expect(startSpy).toHaveBeenCalled();
      expect(result.delivered).toBe(false);
      expect(result.targetStatus).toBe("not_found");

      startSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("handleCoordinatorCall response routing fallback", () => {
    it("routes invoke response via processByCwd when session evicted during restart", async () => {
      const sessionA = "session-a";
      const sessionB = "session-b";
      const projectPath = "/fake/project";

      const tmpDir = join(tmpdir(), "pi-test-coordinator-route");
      mkdirSync(tmpDir, { recursive: true });
      const realPathB = join(tmpDir, "session-b.jsonl");
      writeFileSync(
        realPathB,
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-b",
          timestamp: "2025-01-01T00:00:00.000Z",
          cwd: "/fake/project",
        }) + "\n",
        "utf-8",
      );

      const m = internals(manager);
      const mockManagedA = makeMockManaged({
        sessionId: sessionA,
        projectPath,
        sessionPath: `${tmpDir}/session-a.jsonl`,
      });

      m.clients.set(sessionA, mockManagedA);
      m.processByCwd.set(projectPath, new Set([mockManagedA]));
      m.sessionPaths.set(sessionA, `${tmpDir}/session-a.jsonl`);
      m.sessionPaths.set(sessionB, realPathB);
      m.sessionProjectPaths.set(sessionA, projectPath);
      m.sessionProjectPaths.set(sessionB, projectPath);

      // Mock start() for B — simulates switchSession that evicts A
      vi.spyOn(manager, "start").mockImplementation(
        async (sid: string, _pp: string, sp: string) => {
          if (sid === sessionB) {
            m.clients.delete(sessionA);
            mockManagedA._activeSessionId = sessionB;
            mockManagedA.info.sessionId = sessionB;
            mockManagedA.info.sessionPath = sp;
            m.clients.set(sessionB, mockManagedA);
          }
          return { agentId: sid, status: sid === sessionB ? "started" : "started" };
        },
      );

      const coordSendSpy = vi.fn();
      mockManagedA.client.channel = () =>
        ({
          send: coordSendSpy,
          onReceive: vi.fn(() => () => {}),
          invoke: vi.fn(),
          call: vi.fn(),
        }) as ReturnType<ManagedClientShape["client"]["channel"]>;

      const msg = {
        __call: "session_delegate_send",
        invokeId: "inv_fallback",
        targetSessionId: sessionB,
        message: "test fallback route",
      };

      await m.handleCoordinatorCall(sessionA, msg, "coordinator");

      expect(coordSendSpy).not.toHaveBeenCalled();

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does not crash when session exists in neither clients nor processByCwd", async () => {
      const msg = {
        __call: "session_delegate_status",
        invokeId: "inv_orphan",
        sessionId: "orphan-session",
      };

      await expect(
        internals(manager).handleCoordinatorCall("orphan-session", msg, "coordinator"),
      ).resolves.toBeUndefined();
    });
  });
});
