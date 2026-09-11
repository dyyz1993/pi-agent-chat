/**
 * @vitest-environment node
 *
 * Regression: two concurrent agent.start requests for the same session must
 * not double-spawn CLI children.
 *
 * Root cause (fixed 2026-09-11): AgentProcessManager.start() registered the
 * in-flight promise in _startPromises only AFTER `await resolveRemoteSshStatus`,
 * so two same-tick start() calls both passed the in-flight check and each ran
 * startAgentClientOperation — spawning two CLI children. The loser was
 * overwritten in the clients map and became an orphan ("CLI child survived
 * client.stop() — reaping by pid" in server logs), and its event stream no
 * longer matched the page's subscription. Deployed symptom: on slow hosts
 * (cold spawn ~1.7s), "new session → send immediately" rendered nothing
 * during execution and the whole turn only appeared after refresh.
 *
 * The fix registers the promise synchronously before the first await.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: { piCliPath: "/fake/pi", sandboxEnabled: false },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const startOpMock = vi.fn();
vi.mock("../../../src/shared/agent/agent-start-operations", () => ({
  startAgentClientOperation: (...args: unknown[]) => startOpMock(...args),
  takeWarmProcess: vi.fn(() => undefined),
}));

vi.mock("@dyyz1993/pi-coding-agent", () => ({
  AuthStorage: vi.fn(),
  ModelRegistry: vi.fn(),
}));

import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

class NoopServer {
  emitEvent(): void {}
  register(): void {}
}

function makeManager(): AgentProcessManager {
  return new AgentProcessManager(new NoopServer() as never);
}

const delayed = <T>(value: T, ms: number): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("regression: concurrent agent.start double-spawn race", () => {
  beforeEach(() => {
    startOpMock.mockReset();
  });

  it("same-tick double start() spawns exactly one CLI client and both callers share the result", async () => {
    const manager = makeManager();
    // Simulate a slow remote-SSH status probe (the old race window) and a
    // slow spawn (deployed-host cold start).
    vi.spyOn(
      manager as unknown as { resolveRemoteSshStatus: () => Promise<null> },
      "resolveRemoteSshStatus",
    ).mockReturnValue(delayed(null, 30));

    const spawnResult = { agentId: "sess-race", status: "started" as const };
    startOpMock.mockImplementation(() => delayed(spawnResult, 50));

    const first = manager.start("sess-race", "/repo", "/sessions/sess-race.jsonl");
    const second = manager.start("sess-race", "/repo", "/sessions/sess-race.jsonl");
    const [a, b] = await Promise.all([first, second]);

    // Both callers must observe the SAME start result (the loser joins the
    // winner's in-flight promise instead of spawning its own child).
    expect(startOpMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(spawnResult);
    expect(b).toBe(spawnResult);
  });

  it("a start arriving after the first finished still proceeds normally (no permanent join)", async () => {
    const manager = makeManager();
    vi.spyOn(
      manager as unknown as { resolveRemoteSshStatus: () => Promise<null> },
      "resolveRemoteSshStatus",
    ).mockResolvedValue(null);

    startOpMock.mockImplementation(async () => ({ agentId: "s1", status: "started" }));

    await manager.start("s1", "/repo", "/p1.jsonl");
    await manager.start("s1", "/repo", "/p1.jsonl");

    // Second start re-evaluates (clients map hit inside the operation returns
    // already_running) — the point is it is not stuck joining a finished run.
    expect(startOpMock).toHaveBeenCalledTimes(2);
  });
});
