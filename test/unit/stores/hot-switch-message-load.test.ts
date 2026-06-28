/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";

// We test the extracted hot-switch message load function directly.
// This avoids mocking the entire session store infrastructure.

describe("runHotSwitchMessageLoad", () => {
  it("#37: calls _backgroundRefreshMessages only once when cache exists", async () => {
    const backgroundRefresh = vi.fn().mockResolvedValue(undefined);
    const loadSessionMessages = vi.fn().mockResolvedValue(undefined);
    const getContextUsage = vi.fn().mockResolvedValue({ tokens: 100 });
    const updateSessionContext = vi.fn();

    const { runHotSwitchMessageLoad } = await import(
      "../../../src/mainview/stores/session-active-session"
    );

    await runHotSwitchMessageLoad({
      sessionId: "sess-1",
      sessionPath: "/tmp/sess-1.jsonl",
      hasCached: true,
      backgroundRefresh,
      loadSessionMessages,
      getContextUsage,
      updateSessionContext,
    });

    // _backgroundRefreshMessages should only be called ONCE, not twice
    expect(backgroundRefresh).toHaveBeenCalledTimes(1);
    expect(loadSessionMessages).not.toHaveBeenCalled();
  });

  it("#37: calls loadSessionMessages once when no cache", async () => {
    const backgroundRefresh = vi.fn().mockResolvedValue(undefined);
    const loadSessionMessages = vi.fn().mockResolvedValue(undefined);
    const getContextUsage = vi.fn().mockResolvedValue({ tokens: 50 });
    const updateSessionContext = vi.fn();

    const { runHotSwitchMessageLoad } = await import(
      "../../../src/mainview/stores/session-active-session"
    );

    await runHotSwitchMessageLoad({
      sessionId: "sess-1",
      sessionPath: "/tmp/sess-1.jsonl",
      hasCached: false,
      backgroundRefresh,
      loadSessionMessages,
      getContextUsage,
      updateSessionContext,
    });

    expect(loadSessionMessages).toHaveBeenCalledTimes(1);
    // Should NOT also call backgroundRefresh after loadSessionMessages
    expect(backgroundRefresh).not.toHaveBeenCalled();
  });

  it("#37: fetches context usage after load completes", async () => {
    const backgroundRefresh = vi.fn().mockResolvedValue(undefined);
    const loadSessionMessages = vi.fn().mockResolvedValue(undefined);
    const getContextUsage = vi.fn().mockResolvedValue({ tokens: 200 });
    const updateSessionContext = vi.fn();

    const { runHotSwitchMessageLoad } = await import(
      "../../../src/mainview/stores/session-active-session"
    );

    await runHotSwitchMessageLoad({
      sessionId: "sess-1",
      sessionPath: "/tmp/sess-1.jsonl",
      hasCached: true,
      backgroundRefresh,
      loadSessionMessages,
      getContextUsage,
      updateSessionContext,
    });

    expect(getContextUsage).toHaveBeenCalledWith("sess-1");
    expect(updateSessionContext).toHaveBeenCalledWith("sess-1", { tokens: 200 });
  });
});
