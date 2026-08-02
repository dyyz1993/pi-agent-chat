import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({
      enabled: false,
      state: "idle",
      rawStatus: "none",
      rawPhase: "none",
      continuationSequence: 0,
      turnCount: 0,
    }),
  },
}));

import { useGoalStore } from "../../../src/mainview/stores/use-goal-store";

describe("useGoalStore LRU bounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGoalStore.setState({ bySession: {} });
    // Wipe any cached entries left from previous tests by force-clearing every
    // known sessionId range we use across the suite.
    for (let i = 0; i < 500; i++) {
      useGoalStore.getState().clearSession(`lru-session-${i}`);
      useGoalStore.getState().clearSession(`session-${i}`);
    }
  });

  it("caps bySession size when fetching status for many distinct sessions", async () => {
    for (let i = 0; i < 200; i++) {
      await useGoalStore.getState().fetchStatus(`lru-session-${i}`);
    }

    const state = useGoalStore.getState();
    expect(Object.keys(state.bySession).length).toBeLessThanOrEqual(100);
  });

  it("still serves status for the most recent sessions after LRU eviction", async () => {
    for (let i = 0; i < 200; i++) {
      await useGoalStore.getState().fetchStatus(`lru-session-${i}`);
    }

    const state = useGoalStore.getState();
    // The 100 most-recent sessions (100..199) should still be in state.
    expect(state.bySession["lru-session-199"]).toBeDefined();
    expect(state.bySession["lru-session-100"]).toBeDefined();
    // Older sessions should have been evicted.
    expect(state.bySession["lru-session-0"]).toBeUndefined();
    expect(state.bySession["lru-session-99"]).toBeUndefined();
  });
});
