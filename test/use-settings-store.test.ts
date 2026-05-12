import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

import {
  useSettingsStore,
  useRetryConfigStore,
  RETRY_DEFAULTS,
} from "../src/mainview/stores/use-settings-store";

const DEFAULTS = {
  showToolCalls: true,
  showToolResults: true,
  showThinking: true,
  collapseThinking: true,
  showTimeline: true,
};

beforeEach(() => {
  useSettingsStore.getState().reset();
  useRetryConfigStore.getState().resetRetryConfig();
});

describe("useSettingsStore", () => {
  it("has correct initial values", () => {
    const s = useSettingsStore.getState();
    expect(s.showToolCalls).toBe(true);
    expect(s.showTimeline).toBe(true);
  });

  it("toggle flips showToolCalls", () => {
    useSettingsStore.getState().toggle("showToolCalls");
    expect(useSettingsStore.getState().showToolCalls).toBe(false);
  });

  it("setAll only changes specified keys", () => {
    useSettingsStore.getState().setAll({ showThinking: false });
    const s = useSettingsStore.getState();
    expect(s.showThinking).toBe(false);
    expect(s.showToolCalls).toBe(DEFAULTS.showToolCalls);
  });

  it("reset restores all defaults", () => {
    useSettingsStore.getState().toggle("showToolCalls");
    useSettingsStore.getState().setAll({ showThinking: false });
    useSettingsStore.getState().reset();

    const s = useSettingsStore.getState();
    expect(s.showToolCalls).toBe(DEFAULTS.showToolCalls);
    expect(s.showThinking).toBe(DEFAULTS.showThinking);
  });

  it("toggle on unknown key does not throw", () => {
    expect(() => useSettingsStore.getState().toggle("showToolCalls")).not.toThrow();
  });
});

describe("useRetryConfigStore", () => {
  it("has correct initial values", () => {
    const s = useRetryConfigStore.getState();
    expect(s.enabled).toBe(true);
    expect(s.maxRetries).toBe(20);
  });

  it("setRetryConfig updates only specified fields", () => {
    useRetryConfigStore.getState().setRetryConfig({ maxRetries: 5 });
    const s = useRetryConfigStore.getState();
    expect(s.maxRetries).toBe(5);
    expect(s.enabled).toBe(RETRY_DEFAULTS.enabled);
    expect(s.baseDelayMs).toBe(RETRY_DEFAULTS.baseDelayMs);
  });

  it("resetRetryConfig restores defaults", () => {
    useRetryConfigStore.getState().setRetryConfig({ maxRetries: 1, enabled: false });
    useRetryConfigStore.getState().resetRetryConfig();

    const s = useRetryConfigStore.getState();
    expect(s).toEqual(expect.objectContaining(RETRY_DEFAULTS));
  });
});
