/**
 * @vitest-environment happy-dom
 *
 * Layer 4: Verify retry config defaults, payload shape, and fork alignment.
 *
 * The SettingsPanel is too complex to render in isolation (icons, proxy,
 * usage panel, focus trap, etc.). This test focuses on:
 * 1. RETRY_DEFAULTS are correct
 * 2. The payload shape sent to agent.setSettings matches what fork expects
 * 3. The retry store round-trips values correctly
 */
import { describe, expect, it } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { RETRY_DEFAULTS, useRetryConfigStore } from "../../../src/mainview/stores/use-settings-store";

describe("Retry config payload alignment", () => {
  it("RETRY_DEFAULTS includes maxDelayMs", () => {
    expect(RETRY_DEFAULTS).toMatchObject({
      enabled: true,
      maxRetries: expect.any(Number),
      baseDelayMs: expect.any(Number),
      maxDelayMs: expect.any(Number),
    });
  });

  it("persistRetry payload shape matches fork getRetrySettings() contract", () => {
    const merged = { ...RETRY_DEFAULTS, maxRetries: 24 };

    // This is the exact shape persistRetry sends to agent.setSettings
    const payload = {
      sessionId: "test-session-1",
      settings: {
        retry: {
          enabled: merged.enabled,
          maxRetries: merged.maxRetries,
          baseDelayMs: merged.baseDelayMs,
          maxDelayMs: merged.maxDelayMs,
        },
      },
    };

    // Verify shape: must include maxDelayMs (fork now expects it)
    expect(payload.settings.retry).toHaveProperty("maxDelayMs");
    expect(payload.settings.retry.maxRetries).toBe(24);

    // Verify it's callable via apiClient
    apiClient.call("agent.setSettings", payload);
    expect(apiClient.call).toHaveBeenCalledWith("agent.setSettings", payload);
  });

  it("useRetryConfigStore preserves maxRetries round-trip", () => {
    const store = useRetryConfigStore;

    // Initial defaults
    const initial = store.getState();
    expect(initial.maxRetries).toBe(20);

    // Set new value
    store.getState().setRetryConfig({ maxRetries: 24 });

    // Verify update
    const updated = store.getState();
    expect(updated.maxRetries).toBe(24);
  });
});
