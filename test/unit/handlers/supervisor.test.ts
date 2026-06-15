import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SupervisorTestGlobal {
  __supervisorProcessManager?: unknown;
}

function supervisorTestGlobal(): SupervisorTestGlobal {
  return globalThis as unknown as SupervisorTestGlobal;
}

vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: () => supervisorTestGlobal().__supervisorProcessManager ?? null,
}));

import { register } from "../../../src/shared/handlers/supervisor";
import type { SupervisorStatus } from "../../../src/shared/modules/supervisor";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

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

  it("forwards setGoal to supervisor channel", async () => {
    const goal = {
      id: "goal-1",
      objective: "finish the SPA renderer",
      status: "running" as const,
      startedAt: 1,
      updatedAt: 1,
      continuationCount: 0,
      blockers: [],
    };
    const callChannel = vi.fn().mockResolvedValue({ goal });
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const setGoal = server.handlers.get("supervisor.setGoal")!;

    await expect(
      setGoal({ sessionId: "session-ok", objective: "finish the SPA renderer" }),
    ).resolves.toEqual({ goal });
    expect(callChannel).toHaveBeenCalledWith("session-ok", "supervisor", "setGoal", {
      objective: "finish the SPA renderer",
    });
  });

  it("forwards clearGoal to supervisor channel", async () => {
    const callChannel = vi.fn().mockResolvedValue({ cleared: true });
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const clearGoal = server.handlers.get("supervisor.clearGoal")!;

    await expect(clearGoal({ sessionId: "session-ok", reason: "done" })).resolves.toEqual({
      cleared: true,
    });
    expect(callChannel).toHaveBeenCalledWith("session-ok", "supervisor", "clearGoal", {
      reason: "done",
    });
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
