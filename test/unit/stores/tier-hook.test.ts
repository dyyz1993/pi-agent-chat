import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockSetCurrentModel: vi.fn(),
  mockSetModelForSession: vi.fn(),
  mockCurrentModel: null as { provider: string; id: string } | null,
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({
      setCurrentModel: mocks.mockSetCurrentModel,
      setModelForSession: mocks.mockSetModelForSession,
      currentModel: mocks.mockCurrentModel,
      modelBySession: {},
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
  mockedCall.mockReset();
  mocks.mockCurrentModel = null;
  useTierStore.setState({
    globalDefaults: {},
    hasGlobalDefaults: false,
    dataBySession: {},
    switching: false,
  });
});

describe("useTierStore", () => {
  it("initial state: globalDefaults={}, dataBySession={}, switching=false", () => {
    const s = useTierStore.getState();
    expect(s.globalDefaults).toEqual({});
    expect(s.dataBySession).toEqual({});
    expect(s.switching).toBe(false);
  });

  it("does not expose project-scoped tier APIs", () => {
    const state = useTierStore.getState() as unknown as Record<string, unknown>;
    expect(state.dataByProject).toBeUndefined();
    expect(state.getTierModels).toBeUndefined();
    expect(state.getCurrentTier).toBeUndefined();
    expect(state.setProjectTierModels).toBeUndefined();
    expect(state.setProjectCurrentTier).toBeUndefined();
    expect(state.loadProjectTierConfig).toBeUndefined();
    expect(state.saveProjectTierConfig).toBeUndefined();
  });

  it("syncTierFromModelForSession matches tierModels and sets session tier", () => {
    useTierStore.getState().setGlobalDefaults({
      fast: "anthropic/claude-3-haiku",
      pro: "openai/gpt-4o",
      max: "anthropic/claude-3-opus",
    });
    useTierStore
      .getState()
      .syncTierFromModelForSession("sess-1", "proj-1", "anthropic", "claude-3-haiku");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBe("fast");
    useTierStore
      .getState()
      .syncTierFromModelForSession("sess-1", "proj-1", "anthropic", "claude-3-opus");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBe("max");
    useTierStore.getState().syncTierFromModelForSession("sess-1", "proj-1", "openai", "gpt-4o");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBe("pro");
  });

  it("syncTierFromModelForSession tolerates casing and full model ids from restored state", () => {
    useTierStore.getState().setGlobalDefaults({
      fast: "opencode-go/DeepSeek-V4-Flash",
      pro: "openai/gpt-4o",
      max: "anthropic/claude-3-opus",
    });

    useTierStore
      .getState()
      .syncTierFromModelForSession(
        "sess-1",
        "proj-1",
        "opencode-go",
        "opencode-go/deepseek-v4-flash",
      );

    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBe("fast");
  });

  it("syncTierFromModel keeps the persisted tier when restored model state is incomplete", () => {
    useTierStore.getState().setGlobalDefaults({
      fast: "opencode-go/deepseek-v4-flash",
    });
    useTierStore.getState().setSessionCurrentTier("sess-1", "proj-1", "fast");

    useTierStore.getState().syncTierFromModelForSession("sess-1", "proj-1", "", "");

    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBe("fast");
  });

  it("syncTierFromModel can preserve persisted tier when restored model does not match", () => {
    useTierStore.getState().setGlobalDefaults({
      fast: "opencode-go/deepseek-v4-flash",
    });
    useTierStore.getState().setSessionCurrentTier("sess-1", "proj-1", "fast");

    useTierStore.getState().syncTierFromModelForSession("sess-1", "proj-1", "zhipuai", "glm-5.2", {
      preserveOnMismatch: true,
    });

    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBe("fast");
  });

  it("syncTierFromModel sets null when no tierModels match", () => {
    useTierStore.getState().setGlobalDefaults({ fast: "anthropic/claude-3-haiku" });
    useTierStore
      .getState()
      .syncTierFromModelForSession("sess-1", "proj-1", "google", "gemini-flash");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", "proj-1")).toBeNull();
  });

  it("fetchTierConfig success → session falls back to runtime global defaults", async () => {
    mockedCall
      .mockResolvedValueOnce({ config: null }) // session.loadTierConfig
      .mockResolvedValueOnce({
        models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
      }) // agent.getTierModels → fallback
      .mockResolvedValueOnce({ ok: true }); // agent.setTierModels hydration
    await useTierStore.getState().fetchTierConfig("sess-1");
    expect(useTierStore.getState().globalDefaults).toEqual({
      fast: "a/haiku",
      pro: "a/sonnet",
      max: "a/opus",
    });
    expect(mockedCall).toHaveBeenCalledWith("agent.setTierModels", {
      sessionId: "sess-1",
      models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
    });
  });

  it("fetchTierConfig treats empty runtime tier models as unconfigured globals", async () => {
    mockedCall
      .mockResolvedValueOnce({ config: null })
      .mockResolvedValueOnce({ models: {} })
      .mockResolvedValueOnce({ ok: true });

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().globalDefaults).toEqual({});
    expect(useTierStore.getState().hasGlobalDefaults).toBe(false);
  });

  it("switchToTier success → session current tier updated, switching=false", async () => {
    mockedCall
      .mockResolvedValueOnce({ provider: "anthropic", id: "claude-haiku" })
      .mockResolvedValueOnce({ ok: true });
    await useTierStore.getState().switchToTier("fast", "sess-1");
    expect(mockedCall).toHaveBeenCalledWith("agent.switchTier", {
      sessionId: "sess-1",
      tier: "fast",
    });
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("fast");
    expect(useTierStore.getState().switching).toBe(false);
  });

  it("fetchTierConfig preserves saved currentTier when restored model falls back to an unmatched default", async () => {
    mockedCall
      .mockResolvedValueOnce({
        config: {
          tierModels: { fast: "opencode-go/deepseek-v4-flash", pro: "zhipuai/glm-5.2" },
          currentTier: "fast",
        },
      })
      .mockResolvedValueOnce({ ok: true });
    mocks.mockCurrentModel = { provider: "openai-completions", id: "deepseek-v4-flash" };

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("fast");
  });

  it("saveTierModelsForSession persists new tier models to the session without reloading stale project config", async () => {
    const oldModels = { fast: "old/fast", pro: "old/pro", max: "old/max" };
    const newModels = { fast: "new/fast", pro: "new/pro", max: "new/max" };
    useTierStore.getState().setGlobalDefaults(oldModels);
    useTierStore.getState().setSessionCurrentTier("sess-1", PROJECT_PATH, "pro");

    mockedCall.mockImplementation(async (method: string) => {
      if (method === "agent.setTierModels") return { ok: true };
      if (method === "session.saveTierConfig") return { ok: true };
      if (method === "agent.switchTier") return { provider: "new", id: "pro", tier: "pro" };
      return {};
    });

    await useTierStore.getState().saveTierModelsForSession("sess-1", PROJECT_PATH, newModels);

    expect(useTierStore.getState().getGlobalTierModels()).toEqual(oldModels);
    expect(useTierStore.getState().getTierModelsForSession("sess-1", PROJECT_PATH)).toEqual(
      newModels,
    );
    expect(mockedCall).toHaveBeenCalledWith("agent.setTierModels", {
      sessionId: "sess-1",
      models: newModels,
    });
    expect(mockedCall).toHaveBeenCalledWith("session.saveTierConfig", {
      sessionPath: "/tmp/sess-1.jsonl",
      tierModels: newModels,
      currentTier: "pro",
      currentModel: null,
    });
    expect(mockedCall).toHaveBeenCalledWith("agent.switchTier", {
      sessionId: "sess-1",
      tier: "pro",
    });
    expect(mockedCall).not.toHaveBeenCalledWith("project.loadTierConfig", expect.anything());
  });

  it("saveTierModelsForSession seeds global defaults only when global has not been configured", async () => {
    const firstModels = { fast: "first/fast", pro: "first/pro", max: "first/max" };
    const secondModels = { fast: "second/fast", pro: "second/pro", max: "second/max" };

    mockedCall.mockImplementation(async (method: string) => {
      if (method === "agent.setTierModels") return { ok: true };
      if (method === "session.saveTierConfig") return { ok: true };
      return {};
    });

    await useTierStore.getState().saveTierModelsForSession("sess-1", PROJECT_PATH, firstModels);

    expect(useTierStore.getState().globalDefaults).toEqual(firstModels);

    await useTierStore.getState().saveTierModelsForSession("sess-1", PROJECT_PATH, secondModels);

    expect(useTierStore.getState().globalDefaults).toEqual(firstModels);
    expect(useTierStore.getState().getTierModelsForSession("sess-1", PROJECT_PATH)).toEqual(
      secondModels,
    );
  });

  it("saveGlobalTierModels updates global defaults without writing session or project config", async () => {
    const globalModels = { fast: "global/fast", pro: "global/pro", max: "global/max" };
    mockedCall.mockResolvedValueOnce({ ok: true });

    await useTierStore.getState().saveGlobalTierModels("sess-1", globalModels);

    expect(useTierStore.getState().globalDefaults).toEqual(globalModels);
    expect(useTierStore.getState().hasGlobalDefaults).toBe(true);
    expect(mockedCall).toHaveBeenCalledWith("agent.setTierModels", {
      sessionId: "sess-1",
      models: globalModels,
    });
    expect(mockedCall).not.toHaveBeenCalledWith("session.saveTierConfig", expect.anything());
    expect(mockedCall).not.toHaveBeenCalledWith("project.saveTierConfig", expect.anything());
  });

  it("global defaults are the only shared tier mapping scope", () => {
    useTierStore.getState().setGlobalDefaults({ fast: "f", pro: "p", max: "m" });
    expect(useTierStore.getState().getGlobalTierModels()).toEqual({
      fast: "f",
      pro: "p",
      max: "m",
    });
  });

  it("different projects are not isolated for tier models; sessions own overrides", () => {
    useTierStore.getState().setGlobalDefaults({ fast: "global/fast" });
    useTierStore.getState().setSessionTierModels("sess-a", "/proj-a", { fast: "a/fast" });

    expect(useTierStore.getState().getGlobalTierModels()).toEqual({ fast: "global/fast" });
    expect(useTierStore.getState().getTierModelsForSession("sess-a", "/proj-a")).toEqual({
      fast: "a/fast",
    });
  });

  it("clearSession does not remove global defaults", () => {
    useTierStore.getState().setGlobalDefaults({ fast: "f" });
    useTierStore.getState().setSessionTierModels("sess-1", PROJECT_PATH, { fast: "session/f" });
    useTierStore.getState().clearSession("sess-1");
    expect(useTierStore.getState().getGlobalTierModels()).toEqual({ fast: "f" });
    expect(useTierStore.getState().getTierModelsForSession("sess-1", PROJECT_PATH)).toEqual({
      fast: "f",
    });
  });

  it("switchToTier updates session store model on success", async () => {
    mockedCall
      .mockResolvedValueOnce({ provider: "anthropic", id: "claude-haiku-4" })
      .mockResolvedValueOnce({ ok: true });
    await useTierStore.getState().switchToTier("fast", "sess-1");
    expect(mocks.mockSetModelForSession).toHaveBeenCalledWith(
      "sess-1",
      "anthropic",
      "claude-haiku-4",
    );
  });

  it("switchToTier does not change tier on failure", async () => {
    useTierStore.getState().setSessionCurrentTier("sess-1", PROJECT_PATH, "pro");
    mockedCall.mockRejectedValueOnce(new Error("Model not found"));
    await useTierStore.getState().switchToTier("max", "sess-1");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("pro");
    expect(useTierStore.getState().switching).toBe(false);
  });

  it("fetchTierConfig keeps globalDefaults unchanged on failure", async () => {
    useTierStore.setState({ globalDefaults: { fast: "a/haiku" } });
    mockedCall.mockRejectedValueOnce(new Error("network error"));
    await useTierStore.getState().fetchTierConfig("sess-1");
    expect(useTierStore.getState().globalDefaults).toEqual({ fast: "a/haiku" });
  });

  it("fetchTierConfig deduplicates concurrent fetches for the same project", async () => {
    mockedCall
      .mockResolvedValueOnce({ config: null })
      .mockResolvedValue({ models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" } });

    await Promise.all([
      useTierStore.getState().fetchTierConfig("sess-1"),
      useTierStore.getState().fetchTierConfig("sess-1"),
    ]);

    const agentCalls = mockedCall.mock.calls.filter(
      ([name]: [string]) => name === "agent.getTierModels",
    );
    expect(agentCalls).toHaveLength(1);
  });

  it("#53: cache hit with changed model → syncTierFromModel still runs", async () => {
    // 第一次 fetch：加载 tier 配置
    mockedCall
      .mockResolvedValueOnce({ config: null })
      .mockResolvedValueOnce({
        models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
      })
      .mockResolvedValueOnce({ ok: true });
    mocks.mockCurrentModel = { provider: "a", id: "haiku" };
    await useTierStore.getState().fetchTierConfig("sess-1");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("fast");

    // 模拟用户手动切换到 pro 模型
    mocks.mockCurrentModel = { provider: "a", id: "sonnet" };

    // 第二次 fetch（缓存命中）：不应请求 API，但应 sync 到新模型
    await useTierStore.getState().fetchTierConfig("sess-1");

    // 选中态应更新为 pro
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("pro");

    // API 不应被重复调用
    const loadCalls = mockedCall.mock.calls.filter(
      ([name]: [string]) => name === "agent.getTierModels",
    );
    expect(loadCalls).toHaveLength(1);
  });

  it("#53: cache hit with no currentModel → does not crash", async () => {
    mockedCall
      .mockResolvedValueOnce({ config: null })
      .mockResolvedValueOnce({
        models: { fast: "a/haiku", pro: "a/sonnet", max: "a/opus" },
      })
      .mockResolvedValueOnce({ ok: true });
    mocks.mockCurrentModel = { provider: "a", id: "haiku" };
    await useTierStore.getState().fetchTierConfig("sess-1");

    // currentModel 为 null（例如刚启动尚未获取模型状态）
    mocks.mockCurrentModel = null;

    // 不应抛出异常
    await useTierStore.getState().fetchTierConfig("sess-1");
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("fast");
  });

  it("loads session tier config before global defaults and hydrates runtime", async () => {
    const sessionModels = { fast: "session/fast", pro: "session/pro", max: "session/max" };
    mockedCall
      .mockResolvedValueOnce({
        config: { tierModels: sessionModels, currentTier: "max" },
      })
      .mockResolvedValueOnce({ models: { fast: "global/fast" } })
      .mockResolvedValueOnce({ ok: true });

    await useTierStore.getState().fetchTierConfig("sess-1");

    expect(useTierStore.getState().getTierModelsForSession("sess-1", PROJECT_PATH)).toEqual(
      sessionModels,
    );
    expect(useTierStore.getState().getGlobalTierModels()).toEqual({ fast: "global/fast" });
    expect(useTierStore.getState().getCurrentTierForSession("sess-1", PROJECT_PATH)).toBe("max");
    expect(mockedCall).toHaveBeenCalledWith("agent.setTierModels", {
      sessionId: "sess-1",
      models: sessionModels,
    });
  });
});
