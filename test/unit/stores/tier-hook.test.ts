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

  it("loadProjectTierConfig updates store when config exists", async () => {
    mockedCall.mockResolvedValueOnce({
      config: { tierModels: { fast: "x/fast", pro: "x/pro" }, currentTier: "pro" },
    });
    await useTierStore.getState().loadProjectTierConfig(PROJECT_PATH);
    expect(useTierStore.getState().getCurrentTier(PROJECT_PATH)).toBe("pro");
    expect(useTierStore.getState().getTierModels(PROJECT_PATH)).toEqual({ fast: "x/fast", pro: "x/pro" });
    expect(mockedCall).toHaveBeenCalledWith("project.loadTierConfig", { projectPath: PROJECT_PATH });
  });

  it("loadProjectTierConfig skips when config is null (not persisted)", async () => {
    mockedCall.mockResolvedValueOnce({ config: null });
    const prev = useTierStore.getState().dataByProject[PROJECT_PATH];
    await useTierStore.getState().loadProjectTierConfig(PROJECT_PATH);
    // store unchanged
    expect(useTierStore.getState().dataByProject[PROJECT_PATH]).toBe(prev);
  });

  it("saveProjectTierConfig calls RPC with current state", async () => {
    useTierStore.getState().setProjectTierModels(PROJECT_PATH, {
      fast: "a/fast", pro: "a/pro", max: "a/max",
    });
    useTierStore.getState().setProjectCurrentTier(PROJECT_PATH, "max");
    await useTierStore.getState().saveProjectTierConfig(PROJECT_PATH);
    expect(mockedCall).toHaveBeenCalledWith("project.saveTierConfig", {
      projectPath: PROJECT_PATH,
      tierModels: { fast: "a/fast", pro: "a/pro", max: "a/max" },
      currentTier: "max",
    });
  });

  it("same project path shares tier config across lookups", () => {
    useTierStore.getState().setProjectTierModels("/shared/proj", { fast: "f", pro: "p", max: "m" });
    useTierStore.getState().setProjectCurrentTier("/shared/proj", "fast");
    expect(useTierStore.getState().getCurrentTier("/shared/proj")).toBe("fast");
    expect(useTierStore.getState().getTierModels("/shared/proj")).toEqual({ fast: "f", pro: "p", max: "m" });
  });

  it("different projects have isolated tier configs", () => {
    useTierStore.getState().setProjectTierModels("/proj-a", { fast: "a/fast" });
    useTierStore.getState().setProjectCurrentTier("/proj-a", "fast");
    useTierStore.getState().setProjectTierModels("/proj-b", { pro: "b/pro" });
    useTierStore.getState().setProjectCurrentTier("/proj-b", "pro");

    expect(useTierStore.getState().getCurrentTier("/proj-a")).toBe("fast");
    expect(useTierStore.getState().getCurrentTier("/proj-b")).toBe("pro");
    expect(useTierStore.getState().getTierModels("/proj-a")).toEqual({ fast: "a/fast" });
    expect(useTierStore.getState().getTierModels("/proj-b")).toEqual({ pro: "b/pro" });
  });

  it("clearSession does not remove project tier config", () => {
    useTierStore.getState().setProjectTierModels(PROJECT_PATH, { fast: "f" });
    useTierStore.getState().setProjectCurrentTier(PROJECT_PATH, "fast");
    useTierStore.getState().clearSession("sess-1");
    // Project config should remain after session clear
    expect(useTierStore.getState().getCurrentTier(PROJECT_PATH)).toBe("fast");
    expect(useTierStore.getState().getTierModels(PROJECT_PATH)).toEqual({ fast: "f" });
  });
});
