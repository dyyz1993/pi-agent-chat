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
      checklist: [
        {
          id: "check-1",
          text: "Verify the renderer still boots",
          status: "in_progress" as const,
          kind: "verification" as const,
        },
      ],
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

  it("clears stale goal result when a new goal is set", async () => {
    useSupervisorStore.setState({
      bySession: {
        "sess-1": {
          status: {
            enabled: true,
            state: "idle",
            continueCount: 0,
            maxContinueCount: 5,
            activeGuards: [],
            goal: {
              id: "old-goal",
              objective: "Old goal",
              status: "complete",
              startedAt: 1,
              updatedAt: 2,
              continuationCount: 2,
              blockers: [],
            },
            lastGoldResult: {
              goalId: "old-goal",
              verdict: "complete",
              confidence: 1,
              checkedAt: 3,
              reason: "Old goal passed",
              evidence: [],
            },
          },
          taskReports: [],
          triggerRecords: [
            {
              goalId: "old-goal",
              seq: 1,
              startedAt: 1,
              durationMs: 10,
              verdict: "complete",
              confidence: 1,
              guardResults: [],
              action: "complete",
            },
          ],
        },
      },
    });
    const nextGoal = {
      id: "new-goal",
      objective: "New goal",
      status: "running" as const,
      startedAt: 10,
      updatedAt: 10,
      continuationCount: 0,
      blockers: [],
    };
    mockCall.mockResolvedValueOnce({ goal: nextGoal });

    await useSupervisorStore.getState().setGoal("sess-1", nextGoal.objective);

    const status = useSupervisorStore.getState().bySession["sess-1"]?.status;
    expect(status?.goal).toEqual(nextGoal);
    expect(status?.lastGoldResult).toBeUndefined();
    expect(useSupervisorStore.getState().bySession["sess-1"]?.triggerRecords).toHaveLength(1);
  });

  it("clears the local goal immediately even when clearGoal RPC fails", async () => {
    useSupervisorStore.setState({
      bySession: {
        "sess-1": {
          status: {
            enabled: true,
            state: "idle",
            continueCount: 0,
            maxContinueCount: 5,
            activeGuards: [],
            goal: {
              id: "goal-1",
              objective: "Goal to clear",
              status: "running",
              startedAt: 1,
              updatedAt: 1,
              continuationCount: 0,
              blockers: [],
            },
            lastGoldResult: {
              goalId: "goal-1",
              verdict: "incomplete",
              confidence: 0.9,
              checkedAt: 2,
              reason: "Still running",
              evidence: [],
            },
          },
          taskReports: [],
          triggerRecords: [],
        },
      },
    });
    mockCall.mockRejectedValueOnce(new Error("channel unavailable"));

    await useSupervisorStore.getState().clearGoal("sess-1", "user_cancelled");

    expect(mockCall).toHaveBeenCalledWith("supervisor.clearGoal", {
      sessionId: "sess-1",
      reason: "user_cancelled",
    });
    const status = useSupervisorStore.getState().bySession["sess-1"]?.status;
    expect(status?.goal).toBeUndefined();
    expect(status?.lastGoldResult).toBeUndefined();
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

  it("drops stale gold result when a goalChanged event switches to another goal", () => {
    const oldGoal = {
      id: "goal-old",
      objective: "Old",
      status: "complete" as const,
      startedAt: 1,
      updatedAt: 2,
      continuationCount: 1,
      blockers: [],
    };
    const nextGoal = {
      id: "goal-next",
      objective: "Next",
      status: "running" as const,
      startedAt: 3,
      updatedAt: 3,
      continuationCount: 0,
      blockers: [],
    };

    useSupervisorStore.getState().handleEvent("sess-1", { type: "goalChanged", goal: oldGoal });
    useSupervisorStore.getState().handleEvent("sess-1", {
      type: "goldResult",
      goalId: "goal-old",
      verdict: "complete",
      confidence: 1,
      checkedAt: 4,
      reason: "Old complete",
      evidence: [],
    });
    useSupervisorStore.getState().handleEvent("sess-1", { type: "goalChanged", goal: nextGoal });

    const status = useSupervisorStore.getState().bySession["sess-1"]?.status;
    expect(status?.goal).toEqual(nextGoal);
    expect(status?.lastGoldResult).toBeUndefined();
  });
});
