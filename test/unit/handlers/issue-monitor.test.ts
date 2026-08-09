import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../../../src/shared/handlers/issue-monitor";
import { createMockServer } from "../../helpers/mock-server";
import type { MockServer } from "../../helpers/mock-server";

const managerMocks = vi.hoisted(() => ({
  getProcessManager: vi.fn(),
}));

vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: managerMocks.getProcessManager,
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/shared/lib/with-timeout", () => ({
  withTimeout: (promise: Promise<unknown>) => promise,
}));

async function callHandler(server: MockServer, method: string, params: unknown): Promise<unknown> {
  const handler = server.handlers.get(method);
  if (!handler) throw new Error(`handler ${method} not registered`);
  return handler(params);
}

describe("issue-monitor handler", () => {
  let server: MockServer;
  let callChannel: ReturnType<typeof vi.fn>;
  let hasSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    callChannel = vi.fn();
    hasSession = vi.fn().mockReturnValue(true);
    managerMocks.getProcessManager.mockReturnValue({ callChannel, hasSession });
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
  });

  it("registers issue-monitor.callChannel", () => {
    expect(server.handlers.has("issue-monitor.callChannel")).toBe(true);
  });

  it("returns ok:false when no live session", async () => {
    hasSession.mockReturnValue(false);
    const result = (await callHandler(server, "issue-monitor.callChannel", {
      sessionId: "s1",
      method: "getStatus",
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not running/i);
    expect(callChannel).not.toHaveBeenCalled();
  });

  it("forwards getStatus to issue-monitor channel and returns ok:true with data", async () => {
    const statusPayload = {
      repos: [{ repo: "a/b", openCount: 3, seenCount: 1, newCount: 2, lastError: null }],
      lastScanTime: 123,
      lastScanError: null,
      totalSeen: 1,
      isRunning: true,
    };
    callChannel.mockResolvedValueOnce(statusPayload);

    const result = (await callHandler(server, "issue-monitor.callChannel", {
      sessionId: "s1",
      method: "getStatus",
    })) as { ok: boolean; data?: typeof statusPayload };

    expect(callChannel).toHaveBeenCalledWith("s1", "issue-monitor", "getStatus", {});
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(statusPayload);
  });

  it("forwards getConfig to issue-monitor channel and returns ok:true with config", async () => {
    const configPayload = {
      repos: ["a/b"],
      interval: 600,
      labels: ["bug"],
      autoFix: true,
      branchPrefix: "fix/",
      githubToken: "tok",
    };
    callChannel.mockResolvedValueOnce(configPayload);

    const result = (await callHandler(server, "issue-monitor.callChannel", {
      sessionId: "s1",
      method: "getConfig",
    })) as { ok: boolean; config?: typeof configPayload };

    expect(callChannel).toHaveBeenCalledWith("s1", "issue-monitor", "getConfig", {});
    expect(result.ok).toBe(true);
    expect(result.config).toEqual(configPayload);
  });

  it("returns ok:false with a friendly message when channel call rejects with not-found", async () => {
    callChannel.mockRejectedValueOnce(new Error("Method not found: issue-monitor"));
    const result = (await callHandler(server, "issue-monitor.callChannel", {
      sessionId: "s1",
      method: "getStatus",
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/extension is not installed/i);
  });

  it("returns ok:false on unexpected response shape", async () => {
    callChannel.mockResolvedValueOnce({ weird: true });
    const result = (await callHandler(server, "issue-monitor.callChannel", {
      sessionId: "s1",
      method: "getStatus",
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unexpected response/i);
  });
});
