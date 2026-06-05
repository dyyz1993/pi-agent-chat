/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  getCommandsOperation,
  getSessionStatsOperation,
  getStateOperation,
} from "../src/shared/agent/agent-client-state-operations";

function makeManaged(client: Record<string, unknown>) {
  return { client };
}

describe("agent client state operations", () => {
  it("normalizes state, commands, and session stats", async () => {
    const managed = makeManaged({
      getState: vi.fn().mockResolvedValue({
        model: {
          id: "m1",
          name: "Model",
          provider: "openai",
          reasoning: true,
          contextWindow: "128000",
          maxTokens: "4096",
        },
        thinkingLevel: "medium",
        isStreaming: 1,
        isCompacting: 0,
        messageCount: "12",
      }),
      getCommands: vi.fn().mockResolvedValue([{ name: "build", description: "Run build" }]),
      getSessionStats: vi.fn().mockResolvedValue({
        tokens: { input: "10", output: "2", cacheRead: "3", cacheWrite: "4", total: "19" },
        cost: "0.01",
        contextUsage: { tokens: 19, contextWindow: "128000", percent: 1 },
      }),
    });

    await expect(
      getStateOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn(),
        cleanupDeadClient: vi.fn(),
      }),
    ).resolves.toMatchObject({
      model: { id: "m1", contextWindow: 128000, maxTokens: 4096 },
      isStreaming: true,
      isCompacting: false,
      messageCount: 12,
    });
    await expect(
      getCommandsOperation({ sessionId: "sess-1", getActiveManaged: () => managed }),
    ).resolves.toEqual([{ name: "build", description: "Run build", source: "extension" }]);
    await expect(
      getSessionStatsOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        isClientAlive: vi.fn(),
        cleanupDeadClient: vi.fn(),
      }),
    ).resolves.toMatchObject({
      tokens: { input: 10, output: 2, cacheRead: 3, cacheWrite: 4, total: 19 },
      cost: 0.01,
      contextUsage: { tokens: 19, contextWindow: 128000, percent: 1 },
    });
  });

  it("cleans up dead clients when state probe confirms failure", async () => {
    const managed = makeManaged({
      getState: vi.fn().mockRejectedValue(new Error("closed")),
    });
    const cleanupDeadClient = vi.fn();

    await expect(
      getStateOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn().mockResolvedValue(false),
        cleanupDeadClient,
      }),
    ).resolves.toBeNull();

    expect(cleanupDeadClient).toHaveBeenCalledWith("sess-1", "getState failed: closed");
  });

  it("does not cleanup when session stats fail but client is alive", async () => {
    const managed = makeManaged({
      getSessionStats: vi.fn().mockRejectedValue(new Error("busy")),
    });
    const cleanupDeadClient = vi.fn();

    await expect(
      getSessionStatsOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        isClientAlive: vi.fn().mockResolvedValue(true),
        cleanupDeadClient,
      }),
    ).resolves.toBeNull();

    expect(cleanupDeadClient).not.toHaveBeenCalled();
  });
});
