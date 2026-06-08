/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  getCommandsOperation,
  getSessionStatsOperation,
  getStateOperation,
} from "../src/shared/agent/agent-client-state-operations";

function makeManaged(
  client: Record<string, unknown>,
  info?: {
    activeToolExecutions?: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
  },
) {
  return { client, info };
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
      activeToolExecutions: [],
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

  it("does not cleanup when state query times out", async () => {
    const managed = makeManaged({
      getState: vi.fn().mockRejectedValue(new Error("getState timed out (10000ms)")),
    });
    const cleanupDeadClient = vi.fn();
    const isClientAlive = vi.fn().mockResolvedValue(true);

    await expect(
      getStateOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive,
        cleanupDeadClient,
      }),
    ).resolves.toBeNull();

    expect(isClientAlive).toHaveBeenCalledWith("sess-1", managed);
    expect(cleanupDeadClient).not.toHaveBeenCalled();
  });

  it("returns active tool executions from the managed client snapshot", async () => {
    const managed = makeManaged(
      {
        getState: vi.fn().mockResolvedValue({
          isStreaming: true,
          isCompacting: false,
          messageCount: 1,
        }),
      },
      {
        activeToolExecutions: [
          {
            toolCallId: "tc-1",
            toolName: "bash",
            args: { command: "npm test" },
            startedAt: 123,
          },
        ],
      },
    );

    await expect(
      getStateOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn(),
        cleanupDeadClient: vi.fn(),
      }),
    ).resolves.toMatchObject({
      activeToolExecutions: [
        {
          toolCallId: "tc-1",
          toolName: "bash",
          args: { command: "npm test" },
          startedAt: 123,
        },
      ],
    });
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

  it("does not cleanup when session stats query times out", async () => {
    const managed = makeManaged({
      getSessionStats: vi.fn().mockRejectedValue(new Error("getSessionStats timed out (10000ms)")),
    });
    const cleanupDeadClient = vi.fn();
    const isClientAlive = vi.fn().mockResolvedValue(true);

    await expect(
      getSessionStatsOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        isClientAlive,
        cleanupDeadClient,
      }),
    ).resolves.toBeNull();

    expect(isClientAlive).toHaveBeenCalledWith("sess-1", managed);
    expect(cleanupDeadClient).not.toHaveBeenCalled();
  });
});
