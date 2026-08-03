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

beforeEach(() => {
  vi.clearAllMocks();
  useGoalStore.setState({ bySession: {} });
  for (let i = 0; i < 50; i++) {
    useGoalStore.getState().clearSession(`signal-session-${i}`);
  }
});

describe("use-goal-store signal forwarding", () => {
  it("fetchStatus forwards signal to apiClient.call", async () => {
    callMock.mockResolvedValue({
      enabled: false,
      state: "idle",
      rawStatus: "none",
      rawPhase: "none",
      continuationSequence: 0,
      turnCount: 0,
    });
    const controller = new AbortController();

    await useGoalStore.getState().fetchStatus("signal-session-1", {
      force: true,
      signal: controller.signal,
    });

    expect(callMock).toHaveBeenCalledWith(
      "goal.getStatus",
      { sessionId: "signal-session-1" },
      { signal: controller.signal },
    );
  });

  it("startSetup forwards signal to apiClient.call", async () => {
    callMock.mockResolvedValue({ started: true });
    const controller = new AbortController();

    await useGoalStore.getState().startSetup(
      "signal-session-2",
      "do something",
      { signal: controller.signal },
    );

    expect(callMock).toHaveBeenCalledWith(
      "goal.startSetup",
      { sessionId: "signal-session-2", objective: "do something" },
      { signal: controller.signal },
    );
  });

  it("submitContract forwards signal to apiClient.call", async () => {
    callMock.mockResolvedValue({
      submitted: true,
      goalId: "g-1",
      status: "awaiting_approval",
    });
    const controller = new AbortController();
    const contract = {
      outcome: "x",
      criteria: [],
      phases: [],
      verificationChecks: [],
      authorities: [],
      constraints: [],
      nonGoals: [],
    };

    await useGoalStore.getState().submitContract("signal-session-3", contract, {
      signal: controller.signal,
    });

    expect(callMock).toHaveBeenCalledWith(
      "goal.submitContract",
      expect.objectContaining({ sessionId: "signal-session-3" }),
      { signal: controller.signal },
    );
  });

  it("approveContract forwards signal to apiClient.call", async () => {
    callMock.mockResolvedValue({ approved: true });
    const controller = new AbortController();

    await useGoalStore.getState().approveContract("signal-session-4", {
      signal: controller.signal,
    });

    expect(callMock).toHaveBeenCalledWith(
      "goal.approveContract",
      { sessionId: "signal-session-4" },
      { signal: controller.signal },
    );
  });

  it("action returns safe default when apiClient rejects with AbortError", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    callMock.mockRejectedValue(abortError);
    const controller = new AbortController();
    controller.abort();

    const result = await useGoalStore.getState().startSetup("signal-session-5", "obj", {
      signal: controller.signal,
    });

    expect(result.started).toBe(false);
    expect(result.error).toMatch(/aborted/i);
  });
});
