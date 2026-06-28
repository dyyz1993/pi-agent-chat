import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({
      setCurrentModel: vi.fn(),
      sessionsByProject: {
        "/test/project-a": [
          { sessionId: "sess-1", sessionPath: "/tmp/sess-1.jsonl", projectPath: "/test/project-a" },
        ],
      },
    }),
    subscribe: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useTierStore } from "../../../src/mainview/stores/use-tier-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const PROJECT_PATH = "/test/project-a";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useTierStore.setState({ globalDefaults: {}, dataByProject: {}, switching: false });
});

describe("useTierStore", () => {
  it("initial state: globalDefaults={}, dataByProject={}, switching=false", () => {
    const s = useTierStore.getState();
    expect(s.globalDefaults).toEqual({});
    expect(s.dataByProject).toEqual({});
    expect(s.switching).toBe(false);
  });

  it("setProjectCurrentTier('proj-1', 'fast') → getCurrentTier('proj-1')='fast'", () => {
    useTierStore.getState().setProjectCurrentTier("proj-1", "fast");
    expect(useTierStore.getState().getCurrentTier("proj-1")).toBe("fast");
  });

  it("syncTierFromModel matches tierModels and sets tier", () => {
    useTierStore.getState().setProjectTierModels("proj-1", {
      fast: "anthropic/claude-3-haiku",
      pro: "openai/gpt-4o",
      max: "anthropic/claude-3-opus",
    });
    useTierStore.getState().syncTierFromModel("proj-1", "anthropic", "claude-3-haiku");
    expect(useTierStore.getState().getCurrentTier("proj-1")).toBe("fast");
    useTierStore.getState().syncTierFromModel("proj-1", "anthropic", "claude-3-opus");
    expect(useTierStore.getState().getCurrentTier("proj-1")).toBe("max");
    useTierStore.getState().syncTierFromModel("proj-1", "openai", "gpt-4o");
    expect(useTierStore.getState().getCurrentTier("proj-1")).toBe("pro");
  });

  it("syncTierFromModel sets null when no tierModels match", () => {
    useTierStore.getState().setProjectTierModels("proj-1", { fast: "anthropic/claude-3-haiku" });
    useTierStore.getState().syncTierFromModel("proj-1", "google", "gemini-flash");
    expect(useTierStore.getState().getCurrentTier("proj-1")).toBeNull();
  });

  it("fetchTierConfig success → project tier config loaded from global defaults", async () => {
    mockedCall
      .mockResolvedValueOnce({ config: null }) // project.loadTierConfig → no persisted config
      .mockResolvedValueOnce({
        models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
      }); // agent.getTierModels → fallback
    await useTierStore.getState().fetchTierConfig("sess-1");
    expect(useTierStore.getState().dataByProject[PROJECT_PATH]?.tierModels).toEqual({
      fast: "a/haiku",
      pro: "a/sonnet",
      max: "a/opus",
    });
  });

  it("switchToTier success → getCurrentTier updated, switching=false", async () => {
    mockedCall.mockResolvedValueOnce({ provider: "anthropic", id: "claude-haiku" });
    await useTierStore.getState().switchToTier("fast", "sess-1");
    expect(mockedCall).toHaveBeenCalledWith("agent.switchTier", {
      sessionId: "sess-1",
      tier: "fast",
    });
    expect(useTierStore.getState().getCurrentTier(PROJECT_PATH)).toBe("fast");
    expect(useTierStore.getState().switching).toBe(false);
  });
});
