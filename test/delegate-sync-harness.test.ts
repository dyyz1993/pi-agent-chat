import { describe, expect, it } from "vitest";

import { createMockDeps, SyncDelegateHarness } from "./helpers/delegate-sync-harness";

describe("delegate sync harness", () => {
  it("starts a child delegate and resolves with final text on agent end", async () => {
    const deps = createMockDeps();
    const harness = new SyncDelegateHarness(deps);

    const { sessionId, resultPromise } = harness.startDelegateSync("parent-001", {
      task: "check auth",
      title: "Auth",
    });
    harness.simulateMessageEnd(sessionId, "done");
    harness.simulateAgentEnd(sessionId);

    await expect(resultPromise).resolves.toMatchObject({
      sessionId,
      status: "completed",
      finalText: "done",
    });
    expect(harness.findParentSession(sessionId)).toBe("parent-001");
  });
});
