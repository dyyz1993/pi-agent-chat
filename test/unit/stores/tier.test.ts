import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

const mockSetCurrentModel = vi.fn();
let mockCurrentModel: { provider: string; id: string } | null = null;

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({
      setCurrentModel: mockSetCurrentModel,
      currentModel: mockCurrentModel,
    }),
  },
}));

import { useTierStore } from "../../../src/mainview/stores/use-tier-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentModel = null;
  useTierStore.setState({ globalDefaults: {}, dataBySession: {}, switching: false });
});

describe("setSessionCurrentTier", () => {
  it("sets tier to fast", () => {
    useTierStore.getState().setSessionCurrentTier("sess-1", "fast");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
  });

  it("sets tier to null", () => {
    useTierStore.getState().setSessionCurrentTier("sess-1", "fast");
    useTierStore.getState().setSessionCurrentTier("sess-1", null);
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBeNull();
  });
});

describe("syncTierFromModel", () => {
  const TIER_FIXTURES = {
    fast: "anthropic/claude-haiku-4",
    pro: "anthropic/claude-sonnet-4",
    max: "anthropic/claude-opus-4",
  };

  beforeEach(() => {
    useTierStore.getState().setSessionTierModels("sess-1", TIER_FIXTURES);
  });

  it("syncs fast tier when model matches tierModels.fast", () => {
    useTierStore.getState().syncTierFromModel("sess-1", "anthropic", "claude-haiku-4");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
  });

  it("syncs max tier when model matches tierModels.max", () => {
    useTierStore.getState().syncTierFromModel("sess-1", "anthropic", "claude-opus-4");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("max");
  });

  it("syncs pro tier when model matches tierModels.pro", () => {
    useTierStore.getState().syncTierFromModel("sess-1", "anthropic", "claude-sonnet-4");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("pro");
  });

  it("sets null when model does not match any tier", () => {
    useTierStore.getState().syncTierFromModel("sess-1", "zhipuai", "glm-4");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBeNull();
  });

  it("sets null when tierModels is empty", () => {
    useTierStore.getState().setSessionTierModels("sess-1", {});
    useTierStore.getState().syncTierFromModel("sess-1", "anthropic", "claude-haiku-4");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBeNull();
  });
});

describe("switchToTier", () => {
  it("switches tier successfully", async () => {
    mockedCall.mockResolvedValueOnce({
      provider: "anthropic",
      id: "claude-haiku-4",
    });

    await useTierStore.getState().switchToTier("fast", "sess-1");

    expect(mockedCall).toHaveBeenCalledWith("agent.switchTier", {
      sessionId: "sess-1",
      tier: "fast",
    });
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
    expect(useTierStore.getState().switching).toBe(false);
  });

  it("passes pro tier to the backend switchTier RPC", async () => {
    mockedCall.mockResolvedValueOnce({
      provider: "zhipuai",
      id: "glm-5.1",
    });

    await useTierStore.getState().switchToTier("pro", "sess-1");

    expect(mockedCall).toHaveBeenCalledWith("agent.switchTier", {
      sessionId: "sess-1",
      tier: "pro",
    });
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("pro");
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
    useTierStore.getState().setSessionCurrentTier("sess-1", "pro");
    mockedCall.mockRejectedValueOnce(new Error("Model not found"));

    await useTierStore.getState().switchToTier("max", "sess-1");

    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("pro");
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
  it("fetches tier models from backend and sets globalDefaults", async () => {
    mockedCall.mockResolvedValueOnce({
      models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
    });

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().globalDefaults).toEqual({
      fast: "a/haiku",
      pro: "a/sonnet",
      max: "a/opus",
    });
  });

  it("fetches tier models into the current session and syncs current tier", async () => {
    mockCurrentModel = { provider: "deepseek", id: "deepseek-v4-flash" };
    mockedCall.mockResolvedValueOnce({
      models: {
        fast: "deepseek/deepseek-v4-flash",
        pro: "deepseek/deepseek-v4-pro",
        max: "deepseek/deepseek-v4-pro",
      },
    });

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().getTierModels("sess-1")).toEqual({
      fast: "deepseek/deepseek-v4-flash",
      pro: "deepseek/deepseek-v4-pro",
      max: "deepseek/deepseek-v4-pro",
    });
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
  });

  it("keeps globalDefaults unchanged on failure", async () => {
    useTierStore.setState({ globalDefaults: { fast: "a/haiku" } });
    mockedCall.mockRejectedValueOnce(new Error("network error"));

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().globalDefaults).toEqual({ fast: "a/haiku" });
  });
});
