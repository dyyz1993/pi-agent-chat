/**
 * @vitest-environment node
 *
 * TDD tests for coordinator.session_created broadcast + frontend subscription.
 *
 * Validates:
 * 1. handleCoordinatorDelegate broadcasts coordinator.session_created with correct payload
 * 2. The event metadata filter { parentSessionId } allows RPC server-side matching
 * 3. Frontend-style subscription with filter can receive the event
 * 4. setSessionName is called with correct title
 * 5. send() is called with delegate prompt
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { RPCServer, RPCClient, InMemoryTransport } from "@dyyz1993/rpc-core";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ── Internal types for test access ──
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
  processByCwd: Map<string, ManagedClientShape>;
  parentChildMap: Map<string, Set<string>>;
  handleCoordinatorDelegate: (
    parentSessionId: string,
    msg: { __call: "session_delegate"; task: string; title?: string; invokeId?: string },
  ) => Promise<{ sessionId: string; status: string }>;
  handleCoordinatorCall: (sessionId: string, msg: Record<string, unknown>) => Promise<void>;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: { forceNewProcess?: boolean },
  ) => Promise<{ agentId: string; status: string }>;
  send: (sessionId: string, content: string) => boolean;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
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

describe("coordinator.session_created — TDD 诊断", () => {
  let manager: APM;
  let mockServerEmitEvent: ReturnType<typeof vi.fn>;
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = join(tmpdir(), `pi-test-coord-created-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Track emitEvent calls
    mockServerEmitEvent = vi.fn().mockResolvedValue(undefined);

    // Create manager with mock server
    const mockServer = {
      emitEvent: mockServerEmitEvent,
      register: vi.fn(),
      unregister: vi.fn(),
      close: vi.fn(),
      clearAllSubscriptions: vi.fn(),
    };
    manager = new AgentProcessManager(
      mockServer as unknown as Parameters<typeof AgentProcessManager>[0],
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("handleCoordinatorDelegate", () => {
    it("should throw if parent session not found in clients", async () => {
      const m = internals(manager);
      await expect(
        m.handleCoordinatorDelegate("nonexistent-parent", {
          __call: "session_delegate",
          task: "do something",
        }),
      ).rejects.toThrow("Parent session not found");
    });

    it("should broadcast coordinator.session_created with correct payload and metadata", async () => {
      const parentSessionId = "parent-session-1";
      const projectPath = "/fake/project";
      const sessionPath = join(tmpDir, "parent-session-1.jsonl");
      writeFileSync(
        sessionPath,
        JSON.stringify({ type: "session", version: 3, id: parentSessionId }) + "\n",
      );

      const m = internals(manager);
      const parentManaged = makeMockManaged({
        sessionId: parentSessionId,
        projectPath,
        sessionPath,
      });
      m.clients.set(parentSessionId, parentManaged);
      m.processByCwd.set(projectPath, parentManaged);

      // Mock start() to simulate session creation
      const startSpy = vi.spyOn(manager, "start").mockImplementation(async (sid: string) => {
        const childManaged = makeMockManaged({
          sessionId: sid,
          projectPath,
          sessionPath: join(tmpDir, `${sid}.jsonl`),
        });
        m.clients.set(sid, childManaged);
        return { agentId: sid, status: "started" };
      });

      // Mock send()
      const sendSpy = vi.spyOn(manager, "send").mockReturnValue(true);

      // Mock setSessionName
      const setSessionNameSpy = vi
        .spyOn(
          manager as unknown as { setSessionName: (a: string, b: string) => Promise<void> },
          "setSessionName",
        )
        .mockResolvedValue(undefined);

      const result = await m.handleCoordinatorDelegate(parentSessionId, {
        __call: "session_delegate",
        task: "implement feature X",
        title: "Feature X",
      });

      // Manual poll since vi.waitFor is not available in Bun
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("broadcastEvent not called within 2s")),
          2000,
        );
        const check = () => {
          if (mockServerEmitEvent.mock.calls.length > 0) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });
      expect(mockServerEmitEvent).toHaveBeenCalled();

      // Verify the result
      expect(result.sessionId).toMatch(/^sess_coord_/);
      expect(result.status).toBe("started");

      // Verify broadcastEvent was called with coordinator.session_created
      const sessionCreatedCalls = mockServerEmitEvent.mock.calls.filter(
        (call: unknown[]) => call[0] === "coordinator.session_created",
      );
      expect(sessionCreatedCalls.length).toBeGreaterThanOrEqual(1);

      const [eventType, payload, metadata] = sessionCreatedCalls[0] as [string, unknown, unknown];
      expect(eventType).toBe("coordinator.session_created");

      // Verify payload structure
      const p = payload as { parentSessionId: string; session: Record<string, unknown> };
      expect(p.parentSessionId).toBe(parentSessionId);
      expect(p.session.sessionId).toBe(result.sessionId);
      expect(p.session.name).toBe("指派: Feature X");
      expect(p.session.projectPath).toBe(projectPath);
      expect(p.session.status).toBe("running");

      // REGRESSION: parentSessionPath must point to parent's sessionPath (not null)
      // Before fix: parentSessionPath was always null → delegate showed as root session
      // After fix: parentSessionPath = parent.info.sessionPath → delegate shows as child
      expect(p.session.parentSessionPath).toBe(sessionPath);

      // Verify metadata filter — this is what the frontend subscribe() uses
      const meta = metadata as { parentSessionId: string };
      expect(meta.parentSessionId).toBe(parentSessionId);

      // Verify parent-child relationship
      const children = m.parentChildMap.get(parentSessionId);
      expect(children).toBeDefined();
      expect(children?.has(result.sessionId)).toBe(true);

      // Verify send was called with delegate prompt
      expect(sendSpy).toHaveBeenCalledWith(
        result.sessionId,
        expect.stringContaining("implement feature X"),
      );

      startSpy.mockRestore();
      sendSpy.mockRestore();
      setSessionNameSpy.mockRestore();
    });

    it("should pass forceNewProcess:true to start() to avoid evicting parent from process pool", async () => {
      const parentSessionId = "parent-session-1";
      const projectPath = "/fake/project";
      const sessionPath = join(tmpDir, "parent-session-1.jsonl");
      writeFileSync(
        sessionPath,
        JSON.stringify({ type: "session", version: 3, id: parentSessionId }) + "\n",
      );

      const m = internals(manager);
      const parentManaged = makeMockManaged({
        sessionId: parentSessionId,
        projectPath,
        sessionPath,
      });
      m.clients.set(parentSessionId, parentManaged);
      m.processByCwd.set(projectPath, parentManaged);

      // Spy on start() to capture the options parameter
      const startSpy = vi.spyOn(manager, "start").mockImplementation(async (sid: string) => {
        const childManaged = makeMockManaged({
          sessionId: sid,
          projectPath,
          sessionPath: join(tmpDir, `${sid}.jsonl`),
        });
        m.clients.set(sid, childManaged);
        return { agentId: sid, status: "started" };
      });

      vi.spyOn(manager, "send").mockReturnValue(true);
      vi.spyOn(
        manager as unknown as { setSessionName: (a: string, b: string) => Promise<void> },
        "setSessionName",
      ).mockResolvedValue(undefined);

      await m.handleCoordinatorDelegate(parentSessionId, {
        __call: "session_delegate",
        task: "do something",
      });

      // CRITICAL: start() must be called with { forceNewProcess: true }
      // Without this, the delegate child would reuse the parent's pooled process
      // via processByCwd, evicting the parent from the process pool.
      expect(startSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^sess_coord_/),
        projectPath,
        expect.stringMatching(/\.jsonl$/),
        { forceNewProcess: true },
      );

      startSpy.mockRestore();
    });

    it("should NOT register delegate child in processByCwd (parent must stay pooled)", async () => {
      const parentSessionId = "parent-session-1";
      const projectPath = "/fake/project";
      const sessionPath = join(tmpDir, "parent-session-1.jsonl");
      writeFileSync(
        sessionPath,
        JSON.stringify({ type: "session", version: 3, id: parentSessionId }) + "\n",
      );

      const m = internals(manager);
      const parentManaged = makeMockManaged({
        sessionId: parentSessionId,
        projectPath,
        sessionPath,
      });
      m.clients.set(parentSessionId, parentManaged);
      m.processByCwd.set(projectPath, parentManaged);

      // Mock start to simulate forceNewProcess behavior: do NOT set processByCwd
      vi.spyOn(manager, "start").mockImplementation(
        async (
          sid: string,
          _cwd: string,
          _spath: string,
          options?: { forceNewProcess?: boolean },
        ) => {
          const childManaged = makeMockManaged({
            sessionId: sid,
            projectPath,
            sessionPath: join(tmpDir, `${sid}.jsonl`),
          });
          m.clients.set(sid, childManaged);
          // Simulate real start() behavior: forceNewProcess skips pool registration
          if (!options?.forceNewProcess) {
            m.processByCwd.set(projectPath, childManaged);
          }
          return { agentId: sid, status: "started" };
        },
      );

      vi.spyOn(manager, "send").mockReturnValue(true);
      vi.spyOn(
        manager as unknown as { setSessionName: (a: string, b: string) => Promise<void> },
        "setSessionName",
      ).mockResolvedValue(undefined);

      await m.handleCoordinatorDelegate(parentSessionId, {
        __call: "session_delegate",
        task: "background task",
      });

      // Parent must remain as the pooled process for this projectPath
      expect(m.processByCwd.get(projectPath)).toBe(parentManaged);
    });
  });

  describe("RPC Core subscribe + emitEvent filter matching", () => {
    it("frontend subscription with { parentSessionId } filter receives matching event", async () => {
      // Use real RPC Core (InMemory transport pair) to test end-to-end
      const { client: clientTransport, server: serverTransport } = InMemoryTransport.createPair();
      const rpcServer = new RPCServer(serverTransport);
      const rpcClient = new RPCClient({ transport: clientTransport });

      const parentSessionId = "parent-123";
      const receivedEvents: unknown[] = [];

      // Frontend subscribes with filter — same as session-subscriptions.ts
      rpcClient.subscribe(
        "coordinator.session_created",
        (event: unknown) => {
          receivedEvents.push(event);
        },
        { parentSessionId },
      );

      // Backend emits with matching metadata
      await rpcServer.emitEvent(
        "coordinator.session_created",
        {
          parentSessionId,
          session: {
            sessionId: "sess_coord_123",
            name: "指派: test",
            projectPath: "/fake/project",
            status: "running",
          },
        },
        { parentSessionId },
      );

      // Client should receive the event
      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as { payload: { parentSessionId: string } };
      expect(event.payload.parentSessionId).toBe(parentSessionId);
    });

    it("frontend subscription does NOT receive event with different parentSessionId", async () => {
      const { client: clientTransport, server: serverTransport } = InMemoryTransport.createPair();
      const rpcServer = new RPCServer(serverTransport);
      const rpcClient = new RPCClient({ transport: clientTransport });

      const receivedEvents: unknown[] = [];

      rpcClient.subscribe(
        "coordinator.session_created",
        (event: unknown) => {
          receivedEvents.push(event);
        },
        { parentSessionId: "parent-A" },
      );

      // Emit with DIFFERENT parentSessionId
      await rpcServer.emitEvent(
        "coordinator.session_created",
        {
          parentSessionId: "parent-B",
          session: { sessionId: "sess_coord_456", name: "test" },
        },
        { parentSessionId: "parent-B" },
      );

      // Client should NOT receive the event
      expect(receivedEvents.length).toBe(0);
    });

    it("emitEvent returns silently (no throw) even if no subscriptions exist", async () => {
      const { server: serverTransport } = InMemoryTransport.createPair();
      const rpcServer = new RPCServer(serverTransport);

      // No subscriptions at all — emitEvent should not throw
      await expect(
        rpcServer.emitEvent(
          "coordinator.session_created",
          { some: "data" },
          { parentSessionId: "x" },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("Unknown coordinator methods — gap analysis", () => {
    it("session_delegate_clear_stopped should be handled (not Unknown)", async () => {
      const m = internals(manager);
      const parentSessionId = "parent-1";
      const childSessionId = "child-1";

      // Setup parent-child relationship
      m.parentChildMap.set(parentSessionId, new Set([childSessionId]));
      m.delegateCreatedAt.set(childSessionId, Date.now());
      m.delegateReplyCount.set(childSessionId, 0);

      const msg = {
        __call: "session_delegate_clear_stopped",
        invokeId: "inv_test",
        sessionId: childSessionId,
      };

      // Should NOT throw, should NOT hit "Unknown coordinator method"
      await expect(m.handleCoordinatorCall(parentSessionId, msg)).resolves.toBeUndefined();
    });

    it("session_delegate_remove logs Unknown (no handler yet)", async () => {
      const m = internals(manager);
      const parentSessionId = "parent-1";
      const childSessionId = "child-1";

      m.parentChildMap.set(parentSessionId, new Set([childSessionId]));

      const msg = {
        __call: "session_delegate_remove",
        invokeId: "inv_test2",
        targetSessionId: childSessionId,
      };

      // Currently falls to default "Unknown coordinator method" — resolves undefined
      await expect(m.handleCoordinatorCall(parentSessionId, msg)).resolves.toBeUndefined();
    });
  });
});
