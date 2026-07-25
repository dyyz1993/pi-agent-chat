import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProjectSessionDir } from "../../../src/shared/lib/pi-agent-paths";

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
  let previousAgentDir: string | undefined;
  let agentDir: string;

  async function makeSupervisorDataDir(sessionId: string): Promise<string> {
    const dataDir = join(agentDir, "sessions", "--test-project--", "data", sessionId, "index");
    await mkdir(dataDir, { recursive: true });
    return dataDir;
  }

  async function makeProjectSupervisorDataDir(
    projectPath: string,
    sessionId: string,
  ): Promise<string> {
    const dataDir = join(getProjectSessionDir(projectPath), "data", sessionId, "index");
    await mkdir(dataDir, { recursive: true });
    return dataDir;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    agentDir = await mkdtemp(join(tmpdir(), "pi-supervisor-test-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    supervisorTestGlobal().__supervisorProcessManager = null;
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
  });

  afterEach(async () => {
    supervisorTestGlobal().__supervisorProcessManager = undefined;
    vi.useRealTimers();
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    await rm(agentDir, { recursive: true, force: true });
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

  it("persists a running goal when setGoal channel does not respond", async () => {
    const sessionId = "session-set-goal-timeout";
    const dataDir = await makeSupervisorDataDir(sessionId);
    const callChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const setGoal = server.handlers.get("supervisor.setGoal")!;

    const resultPromise = setGoal({ sessionId, objective: "keep supervisor goal alive" });
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    const result = (await resultPromise) as { goal: { objective: string; status: string } };
    expect(result.goal).toMatchObject({
      objective: "keep supervisor goal alive",
      status: "running",
    });
    const persisted = JSON.parse(
      await readFile(join(dataDir, "supervisor-goal-runtime.json"), "utf-8"),
    ) as { enabled?: boolean; activeGoal?: { objective?: string; status?: string } };
    expect(persisted).toMatchObject({
      enabled: true,
      activeGoal: {
        objective: "keep supervisor goal alive",
        status: "running",
      },
    });
  });

  it("reads persisted goal status when getStatus channel does not respond", async () => {
    const sessionId = "session-status-timeout";
    await makeSupervisorDataDir(sessionId);
    const setGoal = server.handlers.get("supervisor.setGoal")!;
    const setGoalChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel: setGoalChannel };
    const setPromise = setGoal({ sessionId, objective: "recover after reconnect" });
    vi.advanceTimersByTime(5_000);
    await setPromise;

    const getStatusChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel: getStatusChannel };
    const getStatus = server.handlers.get("supervisor.getStatus")!;

    const statusPromise = getStatus({ sessionId });
    vi.advanceTimersByTime(2_500);
    await Promise.resolve();

    const status = (await statusPromise) as SupervisorStatus;
    expect(status.enabled).toBe(true);
    expect(status.goal).toMatchObject({
      objective: "recover after reconnect",
      status: "running",
    });
  });

  it("uses process-manager project path to find persisted goal status directly", async () => {
    const sessionId = "session-direct-project-path";
    const projectPath = "/Users/test/project with spaces";
    const dataDir = await makeProjectSupervisorDataDir(projectPath, sessionId);
    await writeFile(
      join(dataDir, "supervisor-goal-runtime.json"),
      JSON.stringify(
        {
          enabled: true,
          activeGoal: {
            id: "goal-direct",
            objective: "recover by project path",
            status: "running",
            startedAt: 1,
            updatedAt: 2,
            continuationCount: 3,
            blockers: [],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const callChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = {
      callChannel,
      getProjectPathForSession: vi.fn(() => projectPath),
    };
    const getStatus = server.handlers.get("supervisor.getStatus")!;

    const statusPromise = getStatus({ sessionId });
    vi.advanceTimersByTime(2_500);
    await Promise.resolve();

    const status = (await statusPromise) as SupervisorStatus;
    expect(status.enabled).toBe(true);
    expect(status.continueCount).toBe(3);
    expect(status.goal).toMatchObject({
      objective: "recover by project path",
      status: "running",
    });
  });

  it("clears persisted goal when clearGoal channel does not respond", async () => {
    const sessionId = "session-clear-timeout";
    const dataDir = await makeSupervisorDataDir(sessionId);
    const setGoal = server.handlers.get("supervisor.setGoal")!;
    const setGoalChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel: setGoalChannel };
    const setPromise = setGoal({ sessionId, objective: "temporary goal" });
    vi.advanceTimersByTime(5_000);
    await setPromise;

    const clearChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel: clearChannel };
    const clearGoal = server.handlers.get("supervisor.clearGoal")!;

    const clearPromise = clearGoal({ sessionId, reason: "user_cancelled" });
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    await expect(clearPromise).resolves.toEqual({ cleared: true });
    await expect(stat(join(dataDir, "supervisor-goal-runtime.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("updates persisted enabled flag when enable channel does not respond", async () => {
    const sessionId = "session-enable-timeout";
    const dataDir = await makeSupervisorDataDir(sessionId);
    const callChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const enable = server.handlers.get("supervisor.enable")!;

    const resultPromise = enable({ sessionId });
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    await expect(resultPromise).resolves.toEqual({ enabled: true });
    const persisted = JSON.parse(
      await readFile(join(dataDir, "supervisor-goal-runtime.json"), "utf-8"),
    ) as { enabled?: boolean };
    expect(persisted.enabled).toBe(true);
  });

  it("updates persisted enabled flag when disable channel does not respond", async () => {
    const sessionId = "session-disable-timeout";
    const dataDir = await makeSupervisorDataDir(sessionId);
    await writeFile(
      join(dataDir, "supervisor-goal-runtime.json"),
      JSON.stringify({ enabled: true }, null, 2),
      "utf-8",
    );
    const callChannel = vi.fn().mockReturnValue(new Promise(() => {}));
    supervisorTestGlobal().__supervisorProcessManager = { callChannel };
    const disable = server.handlers.get("supervisor.disable")!;

    const resultPromise = disable({ sessionId });
    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    await expect(resultPromise).resolves.toEqual({ disabled: true });
    await expect(stat(join(dataDir, "supervisor-goal-runtime.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
