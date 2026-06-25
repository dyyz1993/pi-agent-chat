/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  cycleModelOperation,
  getAvailableModelsOperation,
  setModelOperation,
  switchTierOperation,
} from "../../../src/shared/agent/agent-client-model-operations";

function makeManaged(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      getAvailableModels: vi.fn().mockResolvedValue([{ provider: "p", id: "m" }]),
      setModel: vi.fn().mockResolvedValue({ provider: "zhipuai", id: "glm-5.1" }),
      cycleModel: vi.fn().mockResolvedValue({
        model: { provider: "p", id: "next" },
        thinkingLevel: "medium",
        isScoped: false,
      }),
      ...overrides,
    },
  };
}

describe("agent client model operations", () => {
  it("ensures a missing client before fetching available models", async () => {
    const managed = makeManaged();
    const ensureManagedClient = vi.fn().mockResolvedValue(managed);

    await expect(
      getAvailableModelsOperation({
        sessionId: "sess-1",
        getActiveManaged: () => null,
        ensureManagedClient,
        isClientAlive: vi.fn(),
        cleanupDeadClient: vi.fn(),
        retryDelayMs: 0,
      }),
    ).resolves.toEqual([
      {
        provider: "p",
        id: "m",
        name: "m",
        contextWindow: undefined,
        reasoning: undefined,
        input: ["text"],
      },
    ]);
    expect(ensureManagedClient).toHaveBeenCalledWith("sess-1");
  });

  it("cleans up a dead client after available models fails", async () => {
    const managed = makeManaged({
      getAvailableModels: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const cleanupDeadClient = vi.fn();

    const models = await getAvailableModelsOperation({
      sessionId: "sess-1",
      getActiveManaged: () => managed,
      ensureManagedClient: vi.fn(),
      isClientAlive: vi.fn().mockResolvedValue(false),
      cleanupDeadClient,
      retryDelayMs: 0,
    });
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "deepseek",
          id: "deepseek-v4-flash",
        }),
      ]),
    );
    expect(cleanupDeadClient).toHaveBeenCalledWith(
      "sess-1",
      "getAvailableModels failed: boom",
    );
  });

  it("sets model and resolves tier mappings", async () => {
    const managed = makeManaged();

    await expect(
      setModelOperation({
        sessionId: "sess-1",
        provider: "zhipuai",
        modelId: "glm-5.1",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
      }),
    ).resolves.toEqual({ provider: "zhipuai", id: "glm-5.1" });

    await expect(
      switchTierOperation({
        tier: "pro",
        getTierModels: vi.fn().mockResolvedValue({ models: { pro: "zhipuai/glm-5.1" } }),
        setModel: vi.fn().mockResolvedValue({ provider: "zhipuai", id: "glm-5.1" }),
      }),
    ).resolves.toEqual({ provider: "zhipuai", id: "glm-5.1", tier: "pro" });
  });

  it("returns null when cycle model has no active client", async () => {
    await expect(
      cycleModelOperation({
        sessionId: "sess-1",
        getActiveManaged: () => null,
        ensureManagedClient: vi.fn().mockResolvedValue(null),
      }),
    ).resolves.toBeNull();
  });
});
