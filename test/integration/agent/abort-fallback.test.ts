import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("handleAbort fallback recovery", () => {
  let sessionStatusMap: Record<string, string>;
  let pushMock: ReturnType<typeof vi.fn>;
  let isAborting: boolean;
  let abortFallbackTimer: ReturnType<typeof setTimeout> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStatusMap = { "sess-1": "streaming" };
    pushMock = vi.fn();
    isAborting = false;
    abortFallbackTimer = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (abortFallbackTimer) clearTimeout(abortFallbackTimer);
  });

  async function handleAbort(
    sessionId: string,
    apiCall: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  ) {
    if (!sessionId) return;
    if (isAborting) return;
    isAborting = true;
    try {
      const result = await apiCall("agent.abort", { sessionId });
      if (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        result.ok === false
      ) {
        sessionStatusMap[sessionId] = "idle";
        pushMock({ message: "Agent already stopped", level: "info" });
        isAborting = false;
        return;
      }
      pushMock({ message: "Agent stopped", level: "info" });
      abortFallbackTimer = setTimeout(() => {
        abortFallbackTimer = undefined;
        const status = sessionStatusMap[sessionId];
        if (status === "streaming" || status === "retrying") {
          sessionStatusMap[sessionId] = "idle";
        }
        isAborting = false;
      }, 10000);
    } catch {
      isAborting = false;
      pushMock({ message: "Failed to stop agent, please try again", level: "error" });
    }
  }

  it("should push info notification on successful abort", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: true });

    await handleAbort("sess-1", apiCall);

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Agent stopped", level: "info" }),
    );
  });

  it("should push error notification on failed abort", async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error("timeout"));

    await handleAbort("sess-1", apiCall);

    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to stop agent, please try again",
        level: "error",
      }),
    );
    expect(isAborting).toBe(false);
  });

  it("should reset isAborting when agent_end arrives before fallback", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: true });

    await handleAbort("sess-1", apiCall);
    expect(isAborting).toBe(true);

    sessionStatusMap["sess-1"] = "idle";
    if (!isAborting) return;

    const isStreaming =
      sessionStatusMap["sess-1"] === "streaming" ||
      sessionStatusMap["sess-1"] === "compacting" ||
      sessionStatusMap["sess-1"] === "retrying";

    if (!isStreaming && isAborting) {
      clearTimeout(abortFallbackTimer);
      abortFallbackTimer = undefined;
      isAborting = false;
    }

    expect(isAborting).toBe(false);
    expect(pushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Session recovered" }),
    );
  });

  it("should silently force-reset session to idle after 10s if agent_end never arrives", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: true });

    await handleAbort("sess-1", apiCall);
    expect(sessionStatusMap["sess-1"]).toBe("streaming");

    vi.advanceTimersByTime(10000);

    expect(sessionStatusMap["sess-1"]).toBe("idle");
    expect(pushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ level: "warning" }),
    );
    expect(isAborting).toBe(false);
  });

  it("should NOT force-reset if session already went idle naturally", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: true });

    await handleAbort("sess-1", apiCall);

    sessionStatusMap["sess-1"] = "idle";

    vi.advanceTimersByTime(10000);

    expect(sessionStatusMap["sess-1"]).toBe("idle");
    expect(pushMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Session recovered" }),
    );
  });

  it("should not allow re-entry while aborting", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: true });

    await handleAbort("sess-1", apiCall);

    expect(isAborting).toBe(true);

    await handleAbort("sess-1", apiCall);

    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("should force-reset retrying session after 10s fallback", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: true });
    sessionStatusMap["sess-1"] = "retrying";

    await handleAbort("sess-1", apiCall);

    vi.advanceTimersByTime(10000);

    expect(sessionStatusMap["sess-1"]).toBe("idle");
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Agent stopped", level: "info" }),
    );
  });

  it("should handle ok:false as already stopped without scheduling fallback", async () => {
    const apiCall = vi.fn().mockResolvedValue({ ok: false });

    await handleAbort("sess-1", apiCall);

    expect(sessionStatusMap["sess-1"]).toBe("idle");
    expect(isAborting).toBe(false);
    expect(abortFallbackTimer).toBeUndefined();
    expect(pushMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Agent already stopped", level: "info" }),
    );
  });
});
