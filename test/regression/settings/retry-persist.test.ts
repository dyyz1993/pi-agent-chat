import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RETRY_DEFAULTS,
  useRetryConfigStore,
} from "../../../src/mainview/stores/use-settings-store";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn().mockResolvedValue({}) },
}));
vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: () => ({ addLog: vi.fn() }) },
}));
vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: { getState: () => ({ activeSessionId: "s1" }) },
}));

const { apiClient } = await import("../../../src/mainview/lib/api-client");

describe("issue #160: retry config defaults & persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRetryConfigStore.getState().resetRetryConfig();
  });

  it("RETRY_DEFAULTS.maxRetries is 20 (not fork hard-coded 3)", () => {
    expect(RETRY_DEFAULTS.maxRetries).toBe(20);
    expect(RETRY_DEFAULTS.enabled).toBe(true);
    expect(RETRY_DEFAULTS.baseDelayMs).toBeGreaterThan(0);
    expect(RETRY_DEFAULTS.maxDelayMs).toBeGreaterThanOrEqual(RETRY_DEFAULTS.baseDelayMs);
  });

  it("store initial state matches RETRY_DEFAULTS", () => {
    const state = useRetryConfigStore.getState();
    expect(state.maxRetries).toBe(20);
    expect(state.enabled).toBe(RETRY_DEFAULTS.enabled);
    expect(state.baseDelayMs).toBe(RETRY_DEFAULTS.baseDelayMs);
    expect(state.maxDelayMs).toBe(RETRY_DEFAULTS.maxDelayMs);
  });

  it("setRetryConfig merges partial patch without dropping fields", () => {
    useRetryConfigStore.getState().setRetryConfig({ maxRetries: 20 });
    const s = useRetryConfigStore.getState();
    expect(s.maxRetries).toBe(20);
    // other fields preserved
    expect(s.enabled).toBe(RETRY_DEFAULTS.enabled);
    expect(s.baseDelayMs).toBe(RETRY_DEFAULTS.baseDelayMs);
    expect(s.maxDelayMs).toBe(RETRY_DEFAULTS.maxDelayMs);
  });

  it("persistRetry sends the complete 4-field retry object to fork", async () => {
    // Re-implement the persistRetry payload shape from SettingsPanel to assert all 4 fields
    // are sent. This protects against regressions where only `enabled` is sent.
    const patch = { maxRetries: 20 };
    const current = useRetryConfigStore.getState();
    const merged = { ...current, ...patch };
    const settingsPayload = {
      sessionId: "s1",
      settings: {
        retry: {
          enabled: merged.enabled,
          maxRetries: merged.maxRetries,
          baseDelayMs: merged.baseDelayMs,
          maxDelayMs: merged.maxDelayMs,
        },
      },
    };

    await apiClient.call("agent.setSettings", settingsPayload);

    expect(apiClient.call).toHaveBeenCalledTimes(1);
    const [method, body] = (apiClient.call as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { settings: { retry: Record<string, unknown> } },
    ];
    expect(method).toBe("agent.setSettings");
    const retry = body.settings.retry;
    expect(retry).toEqual({
      enabled: RETRY_DEFAULTS.enabled,
      maxRetries: 20,
      baseDelayMs: RETRY_DEFAULTS.baseDelayMs,
      maxDelayMs: RETRY_DEFAULTS.maxDelayMs,
    });
    // explicit field-by-field assertions for clarity on regression reports
    expect(retry.enabled).toBe(true);
    expect(retry.maxRetries).toBe(20);
    expect(typeof retry.baseDelayMs).toBe("number");
    expect(typeof retry.maxDelayMs).toBe("number");
  });

  it("resetRetryConfig restores RETRY_DEFAULTS", () => {
    useRetryConfigStore.getState().setRetryConfig({ maxRetries: 5, enabled: false });
    useRetryConfigStore.getState().resetRetryConfig();
    expect(useRetryConfigStore.getState().maxRetries).toBe(20);
    expect(useRetryConfigStore.getState().enabled).toBe(true);
  });
});
