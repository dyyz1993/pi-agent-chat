import { describe, it, expect, beforeEach, vi } from "vitest";

const { callMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: callMock,
    onReconnect: vi.fn(),
  },
}));

import { useGoalStore } from "../../../src/mainview/stores/use-goal-store";

/**
 * Page-load race (2026-09-15 mobile audit): goal.getStatus is fired right
 * after subscribe while the page's own agent.start may still be spawning the
 * CLI — the channel call can fail, and a swallowed failure meant the goal
 * card / approval entry never rendered for the whole page lifetime (the user
 * saw "no way to approve" on mobile after refresh).
 *
 * Contract: fetchStatus retries transient failures (bounded, with backoff)
 * so the goal state eventually lands; AbortError is not retried.
 */
describe("use-goal-store fetchStatus retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGoalStore.setState({ bySession: {} });
    useGoalStore.getState().clearSession("retry-session");
  });

  it("retries a transient failure and lands the status", async () => {
    const status = { enabled: true, state: "awaiting", rawStatus: "awaiting_approval", rawPhase: "none" };
    callMock
      .mockRejectedValueOnce(new Error("Client not found"))
      .mockRejectedValueOnce(new Error("channel timeout"))
      .mockResolvedValue(status as never);

    await useGoalStore.getState().fetchStatus("retry-session", { force: true });

    expect(callMock).toHaveBeenCalledTimes(3);
    const stored = useGoalStore.getState().bySession["retry-session"];
    expect(stored?.status?.rawStatus).toBe("awaiting_approval");
  });

  it("gives up after the bounded retry budget without throwing", async () => {
    callMock.mockRejectedValue(new Error("still down"));
    await expect(
      useGoalStore.getState().fetchStatus("retry-session", { force: true }),
    ).resolves.toBeUndefined();
    expect(callMock).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("does not retry aborted requests", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    callMock.mockRejectedValue(abortError);
    await useGoalStore.getState().fetchStatus("retry-session", { force: true });
    expect(callMock).toHaveBeenCalledTimes(1);
  });
});
