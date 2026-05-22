import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

const mockSetCurrentModel = vi.fn();

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({
      setCurrentModel: mockSetCurrentModel,
    }),
  },
}));

import { useTierStore } from "../src/mainview/stores/use-tier-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useTierStore.setState({ currentTier: null, switching: false, tierModels: {} });
});

describe("setCurrentTier", () => {
  it("sets tier to fast", () => {
    useTierStore.getState().setCurrentTier("fast");
    expect(useTierStore.getState().currentTier).toBe("fast");
  });

  it("sets tier to null", () => {
    useTierStore.getState().setCurrentTier("fast");
    useTierStore.getState().setCurrentTier(null);
    expect(useTierStore.getState().currentTier).toBeNull();
  });
});

describe("syncTierFromModel", () => {
  const TIER_FIXTURES = {
    fast: "anthropic/claude-haiku-4",
    pro: "anthropic/claude-sonnet-4",
    max: "anthropic/claude-opus-4",
  };

  beforeEach(() => {
    useTierStore.setState({ tierModels: TIER_FIXTURES });
  });

  it("syncs fast tier when model matches tierModels.fast", () => {
    useTierStore.getState().syncTierFromModel("anthropic", "claude-haiku-4");
    expect(useTierStore.getState().currentTier).toBe("fast");
  });

  it("syncs max tier when model matches tierModels.max", () => {
    useTierStore.getState().syncTierFromModel("anthropic", "claude-opus-4");
    expect(useTierStore.getState().currentTier).toBe("max");
  });

  it("syncs pro tier when model matches tierModels.pro", () => {
    useTierStore.getState().syncTierFromModel("anthropic", "claude-sonnet-4");
    expect(useTierStore.getState().currentTier).toBe("pro");
  });

  it("sets null when model does not match any tier", () => {
    useTierStore.getState().syncTierFromModel("zhipuai", "glm-4");
    expect(useTierStore.getState().currentTier).toBeNull();
  });

  it("sets null when tierModels is empty", () => {
    useTierStore.setState({ tierModels: {} });
    useTierStore.getState().syncTierFromModel("anthropic", "claude-haiku-4");
    expect(useTierStore.getState().currentTier).toBeNull();
  });
});

describe("switchToTier", () => {
  it("switches tier successfully", async () => {
    mockedCall.mockResolvedValueOnce({
      provider: "anthropic",
      id: "claude-haiku-4",
    });

    await useTierStore.getState().switchToTier("fast", "sess-1");

    expect(useTierStore.getState().currentTier).toBe("fast");
    expect(useTierStore.getState().switching).toBe(false);
  });

  it("updates session store model on success", async () => {
    mockedCall.mockResolvedValueOnce({
      provider: "anthropic",
      id: "claude-haiku-4",
    });

    await useTierStore.getState().switchToTier("fast", "sess-1");

    expect(mockSetCurrentModel).toHaveBeenCalledWith("anthropic", "claude-haiku-4");
  });

  it("does not change tier on failure", async () => {
    useTierStore.setState({ currentTier: "pro" });
    mockedCall.mockRejectedValueOnce(new Error("Model not found"));

    await useTierStore.getState().switchToTier("max", "sess-1");

    expect(useTierStore.getState().currentTier).toBe("pro");
    expect(useTierStore.getState().switching).toBe(false);
  });

  it("sets switching to false after success", async () => {
    mockedCall.mockResolvedValueOnce({
      provider: "anthropic",
      id: "claude-haiku-4",
    });

    await useTierStore.getState().switchToTier("fast", "sess-1");

    expect(useTierStore.getState().switching).toBe(false);
  });
});

describe("fetchTierConfig", () => {
  it("fetches tier models from backend", async () => {
    mockedCall.mockResolvedValueOnce({
      models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
    });

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().tierModels).toEqual({
      fast: "a/haiku",
      pro: "a/sonnet",
      max: "a/opus",
    });
  });

  it("keeps tierModels unchanged on failure", async () => {
    useTierStore.setState({ tierModels: { fast: "a/haiku" } });
    mockedCall.mockRejectedValueOnce(new Error("network error"));

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().tierModels).toEqual({ fast: "a/haiku" });
  });
});
