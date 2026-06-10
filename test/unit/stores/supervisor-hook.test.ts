import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

import { apiClient } from "../../../src/mainview/lib/api-client";
import { useSupervisorStore } from "../../../src/mainview/stores/use-supervisor-store";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;

describe("useSupervisorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSupervisorStore.setState({ bySession: {} });
  });

  it("sets goal from supervisor RPC result", async () => {
    const goal = {
      id: "goal-1",
      objective: "Finish the SPA renderer",
      status: "running" as const,
      startedAt: 1,
      updatedAt: 1,
      continuationCount: 0,
      blockers: [],
    };
    mockCall.mockResolvedValueOnce({ goal });

    await useSupervisorStore.getState().setGoal("sess-1", goal.objective);

    expect(mockCall).toHaveBeenCalledWith("supervisor.setGoal", {
      sessionId: "sess-1",
      objective: goal.objective,
    });
    expect(useSupervisorStore.getState().bySession["sess-1"]?.status?.goal).toEqual(goal);
  });

  it("handles goal and gold channel events", () => {
    const goal = {
      id: "goal-1",
      objective: "Finish the SPA renderer",
      status: "checking" as const,
      startedAt: 1,
      updatedAt: 2,
      continuationCount: 1,
      blockers: [],
    };
    useSupervisorStore.getState().handleEvent("sess-1", { type: "goalChanged", goal });
    useSupervisorStore.getState().handleEvent("sess-1", {
      type: "goldResult",
      goalId: "goal-1",
      verdict: "incomplete",
      confidence: 0.9,
      checkedAt: 3,
      reason: "M4 is not done",
      evidence: [{ kind: "model", summary: "SPA goal not verified", passed: false }],
      continueMessage: "Continue M4",
    });

    const status = useSupervisorStore.getState().bySession["sess-1"]?.status;
    expect(status?.goal).toEqual(goal);
    expect(status?.lastGoldResult?.verdict).toBe("incomplete");
    expect(status?.lastGoldResult?.continueMessage).toBe("Continue M4");
  });
});
