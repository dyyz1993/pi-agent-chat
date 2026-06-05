import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SupervisorTestGlobal {
  __supervisorProcessManager?: unknown;
}

function supervisorTestGlobal(): SupervisorTestGlobal {
  return globalThis as unknown as SupervisorTestGlobal;
}

vi.mock("../src/shared/handlers/agent", () => ({
  getProcessManager: () => supervisorTestGlobal().__supervisorProcessManager ?? null,
}));

import { register } from "../src/shared/handlers/supervisor";
import type { SupervisorStatus } from "../src/shared/modules/supervisor";

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    register: vi.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    }),
    handlers,
    subscriptions: new Map(),
    emitEvent: vi.fn(),
  };
}

type MockServer = ReturnType<typeof createMockServer>;

const disabledStatus: SupervisorStatus = {
  enabled: false,
  state: "disabled",
  continueCount: 0,
  maxContinueCount: 0,
  activeGuards: [],
};

describe("supervisor handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    supervisorTestGlobal().__supervisorProcessManager = null;
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
  });

  afterEach(() => {
    supervisorTestGlobal().__supervisorProcessManager = undefined;
    vi.useRealTimers();
  });

  it("returns disabled status when no process manager exists", async () => {
    const getStatus = server.handlers.get("supervisor.getStatus")!;

    await expect(getStatus({ sessionId: "missing" })).resolves.toEqual(disabledStatus);
  });

  it("returns supervisor channel status when it responds", async () => {
    const status: SupervisorStatus = {
      enabled: true,
      state: "idle",
      continueCount: 1,
      maxContinueCount: 3,
      activeGuards: ["tasks"],
    };
    const callChannel = vi.fn().mockResolvedValue(status);
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const getStatus = server.handlers.get("supervisor.getStatus")!;

    await expect(getStatus({ sessionId: "session-ok" })).resolves.toEqual(status);
    expect(callChannel).toHaveBeenCalledWith("session-ok", "supervisor", "getStatus", {});
  });

  it("does not block when supervisor channel does not respond", async () => {
    const callChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const getStatus = server.handlers.get("supervisor.getStatus")!;

    const result = getStatus({ sessionId: "session-slow" });
    vi.advanceTimersByTime(2500);
    await Promise.resolve();

    await expect(result).resolves.toEqual(disabledStatus);
    expect(callChannel).toHaveBeenCalledWith("session-slow", "supervisor", "getStatus", {});
  });
});
