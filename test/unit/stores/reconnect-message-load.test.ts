/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from "vitest";

describe("runReconnectMessageLoad", () => {
  it("#37: loadSessionMessages called once, _backgroundRefreshMessages NOT called", async () => {
    const loadSessionMessages = vi.fn().mockResolvedValue(undefined);
    const backgroundRefresh = vi.fn().mockResolvedValue(undefined);
    const getContextUsage = vi.fn().mockResolvedValue({ tokens: 100 });
    const updateSessionContext = vi.fn();

    const { runReconnectMessageLoad } = await import(
      "../../../src/mainview/stores/session-active-session"
    );

    await runReconnectMessageLoad({
      sessionId: "sess-1",
      sessionPath: "/tmp/sess-1.jsonl",
      loadSessionMessages,
      backgroundRefresh,
      getContextUsage,
      updateSessionContext,
    });

    // loadSessionMessages called exactly once with force: true
    expect(loadSessionMessages).toHaveBeenCalledTimes(1);
    expect(loadSessionMessages).toHaveBeenCalledWith("sess-1", {
      force: true,
      sessionPath: "/tmp/sess-1.jsonl",
    });

    // _backgroundRefreshMessages should NOT be called separately (#37 root cause #2/#3)
    expect(backgroundRefresh).not.toHaveBeenCalled();
  });

  it("#37: context usage fetched after load", async () => {
    const loadSessionMessages = vi.fn().mockResolvedValue(undefined);
    const backgroundRefresh = vi.fn().mockResolvedValue(undefined);
    const getContextUsage = vi.fn().mockResolvedValue({ tokens: 500 });
    const updateSessionContext = vi.fn();

    const { runReconnectMessageLoad } = await import(
      "../../../src/mainview/stores/session-active-session"
    );

    await runReconnectMessageLoad({
      sessionId: "sess-1",
      sessionPath: "/tmp/sess-1.jsonl",
      loadSessionMessages,
      backgroundRefresh,
      getContextUsage,
      updateSessionContext,
    });

    expect(getContextUsage).toHaveBeenCalledWith("sess-1");
    expect(updateSessionContext).toHaveBeenCalledWith("sess-1", { tokens: 500 });
  });

  it("#37: does not crash when loadSessionMessages fails", async () => {
    const loadSessionMessages = vi.fn().mockRejectedValue(new Error("network error"));
    const backgroundRefresh = vi.fn().mockResolvedValue(undefined);
    const getContextUsage = vi.fn().mockResolvedValue({ tokens: 0 });
    const updateSessionContext = vi.fn();

    const { runReconnectMessageLoad } = await import(
      "../../../src/mainview/stores/session-active-session"
    );

    // Should not throw
    await runReconnectMessageLoad({
      sessionId: "sess-1",
      sessionPath: "/tmp/sess-1.jsonl",
      loadSessionMessages,
      backgroundRefresh,
      getContextUsage,
      updateSessionContext,
    });

    expect(loadSessionMessages).toHaveBeenCalledTimes(1);
    expect(backgroundRefresh).not.toHaveBeenCalled();
  });
});
