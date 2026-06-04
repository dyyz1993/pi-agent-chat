import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
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
  useTierStore.setState({ globalDefaults: {}, dataBySession: {}, switching: false });
});

describe("useTierStore", () => {
  it("initial state: globalDefaults={}, dataBySession={}, switching=false", () => {
    const s = useTierStore.getState();
    expect(s.globalDefaults).toEqual({});
    expect(s.dataBySession).toEqual({});
    expect(s.switching).toBe(false);
  });

  it("setSessionCurrentTier('sess-1', 'fast') → getCurrentTier('sess-1')='fast'", () => {
    useTierStore.getState().setSessionCurrentTier("sess-1", "fast");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
  });

  it("syncTierFromModel matches tierModels and sets tier", () => {
    useTierStore.getState().setSessionTierModels("sess-1", {
      fast: "anthropic/claude-3-haiku",
      pro: "openai/gpt-4o",
      max: "anthropic/claude-3-opus",
    });
    useTierStore.getState().syncTierFromModel("sess-1", "anthropic", "claude-3-haiku");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
    useTierStore.getState().syncTierFromModel("sess-1", "anthropic", "claude-3-opus");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("max");
    useTierStore.getState().syncTierFromModel("sess-1", "openai", "gpt-4o");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("pro");
  });

  it("syncTierFromModel sets null when no tierModels match", () => {
    useTierStore.getState().setSessionTierModels("sess-1", { fast: "anthropic/claude-3-haiku" });
    useTierStore.getState().syncTierFromModel("sess-1", "google", "gemini-flash");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBeNull();
  });

  it("fetchTierConfig success → globalDefaults set", async () => {
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

  it("switchToTier success → getCurrentTier updated, switching=false", async () => {
    mockedCall.mockResolvedValueOnce({ provider: "anthropic", id: "claude-haiku" });
    await useTierStore.getState().switchToTier("fast", "sess-1");
    expect(useTierStore.getState().getCurrentTier("sess-1")).toBe("fast");
    expect(useTierStore.getState().switching).toBe(false);
  });
});
