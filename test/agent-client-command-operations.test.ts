/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  getAgentsOperation,
  getCurrentAgentOperation,
  getTierModelsOperation,
  setTierModelsOperation,
  switchAgentOperation,
} from "../src/shared/agent/agent-client-command-operations";

function makeManaged(send: ReturnType<typeof vi.fn>) {
  return {
    client: {
      send,
    },
  };
}

describe("agent client command operations", () => {
  it("gets and sets tier model mappings through the command client", async () => {
    const send = vi.fn().mockResolvedValue({ data: { models: { pro: "p/m" } } });
    const managed = makeManaged(send);

    await expect(
      getTierModelsOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        retryDelayMs: 0,
      }),
    ).resolves.toEqual({ models: { pro: "p/m" } });

    await expect(
      setTierModelsOperation({
        sessionId: "sess-1",
        models: { max: "p/max" },
        getActiveManaged: () => managed,
      }),
    ).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({ type: "set_tier_models", models: { max: "p/max" } });
  });

  it("normalizes agent lists and switches agents", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          agents: [{ name: "reviewer", source: "project", filePath: "/agents/reviewer.md" }],
        },
      })
      .mockResolvedValueOnce({ data: { agentName: "reviewer", tools: ["read"], tier: "pro" } });
    const managed = makeManaged(send);

    await expect(
      getAgentsOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
      }),
    ).resolves.toEqual({
      agents: [{ name: "reviewer", source: "project", filePath: "/agents/reviewer.md" }],
    });

    await expect(
      switchAgentOperation({
        sessionId: "sess-1",
        agentName: "reviewer",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
      }),
    ).resolves.toEqual({ agentName: "reviewer", tools: ["read"], tier: "pro" });
  });

  it("returns null current agent when no client is available", async () => {
    await expect(
      getCurrentAgentOperation({
        sessionId: "sess-1",
        getActiveManaged: () => null,
        ensureManagedClient: vi.fn().mockResolvedValue(null),
      }),
    ).resolves.toEqual({ agentName: null });
  });
});
