import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({ setCurrentModel: vi.fn() }),
    subscribe: vi.fn(),
  },
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useTierStore } from "../src/mainview/stores/use-tier-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useTierStore.setState({ currentTier: null, switching: false, tierModels: {} });
});

describe("useTierStore", () => {
  it("initial state: currentTier=null, switching=false", () => {
    const s = useTierStore.getState();
    expect(s.currentTier).toBeNull();
    expect(s.switching).toBe(false);
  });

  it("setCurrentTier('fast') → currentTier='fast'", () => {
    useTierStore.getState().setCurrentTier("fast");
    expect(useTierStore.getState().currentTier).toBe("fast");
  });

  it("syncTierFromModel('anthropic','claude-3-haiku') → currentTier='fast'", () => {
    useTierStore.getState().syncTierFromModel("anthropic", "claude-3-haiku");
    expect(useTierStore.getState().currentTier).toBe("fast");
  });

  it("syncTierFromModel('anthropic','claude-3-opus') → currentTier='max'", () => {
    useTierStore.getState().syncTierFromModel("anthropic", "claude-3-opus");
    expect(useTierStore.getState().currentTier).toBe("max");
  });

  it("syncTierFromModel('openai','gpt-4o') → currentTier='pro'", () => {
    useTierStore.getState().syncTierFromModel("openai", "gpt-4o");
    expect(useTierStore.getState().currentTier).toBe("pro");
  });

  it("syncTierFromModel('google','gemini-flash') → currentTier='fast'", () => {
    useTierStore.getState().syncTierFromModel("google", "gemini-flash");
    expect(useTierStore.getState().currentTier).toBe("fast");
  });

  it("fetchTierConfig success → tierModels set", async () => {
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

  it("switchToTier success → currentTier updated, switching=false", async () => {
    mockedCall.mockResolvedValueOnce({ provider: "anthropic", id: "claude-haiku" });
    await useTierStore.getState().switchToTier("fast", "sess-1");
    expect(useTierStore.getState().currentTier).toBe("fast");
    expect(useTierStore.getState().switching).toBe(false);
  });
});
