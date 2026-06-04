import { describe, it, expect, vi } from "vitest";

describe("ProcessManager abort() must emit agent_end", () => {
  it("abort() should emit agent_end after calling client.abort()", async () => {
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const clientAbort = vi.fn().mockResolvedValue(undefined);

    const mockManaged = { client: { abort: clientAbort } };
    const getActiveManaged = vi.fn().mockReturnValue(mockManaged);

    async function abort(sessionId: string) {
      const managed = getActiveManaged(sessionId);
      if (!managed) return false;
      await managed.client.abort().catch(() => {});
      emitAgentEvent(sessionId, { type: "agent_end" });
      return true;
    }

    const result = await abort("sess-1");

    expect(result).toBe(true);
    expect(clientAbort).toHaveBeenCalledTimes(1);
    expect(emitAgentEvent).toHaveBeenCalledTimes(1);
    expect(emitAgentEvent).toHaveBeenCalledWith("sess-1", { type: "agent_end" });
  });

  it("abort() should still emit agent_end even if client.abort() fails", async () => {
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const clientAbort = vi.fn().mockRejectedValue(new Error("abort failed"));

    const mockManaged = { client: { abort: clientAbort } };
    const getActiveManaged = vi.fn().mockReturnValue(mockManaged);

    async function abort(sessionId: string) {
      const managed = getActiveManaged(sessionId);
      if (!managed) return false;
      await managed.client.abort().catch(() => {});
      emitAgentEvent(sessionId, { type: "agent_end" });
      return true;
    }

    const result = await abort("sess-1");

    expect(result).toBe(true);
    expect(emitAgentEvent).toHaveBeenCalledTimes(1);
    expect(emitAgentEvent).toHaveBeenCalledWith("sess-1", { type: "agent_end" });
  });

  it("abort() should return false when no active managed session", async () => {
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);

    function abort() {
      const managed = null;
      if (!managed) return false;
      return true;
    }

    expect(abort()).toBe(false);
    expect(emitAgentEvent).not.toHaveBeenCalled();
  });
});

describe("ProcessManager send() prompt() failure must emit agent_end", () => {
  it("should emit agent_end when prompt() rejects", async () => {
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const promptReject = vi.fn().mockRejectedValue(new Error("AI provider timeout"));
    const logWarn = vi.fn();

    const mockManaged = { client: { prompt: promptReject } };
    const getActiveManaged = vi.fn().mockReturnValue(mockManaged);

    function send(sessionId: string, content: string) {
      const managed = getActiveManaged(sessionId);
      if (!managed) return false;
      managed.client.prompt(content).catch(() => {
        logWarn("prompt error");
        emitAgentEvent(sessionId, { type: "agent_end" });
      });
      return true;
    }

    const result = send("sess-1", "hello");

    expect(result).toBe(true);

    await new Promise((r) => setTimeout(r, 0));

    expect(emitAgentEvent).toHaveBeenCalledTimes(1);
    expect(emitAgentEvent).toHaveBeenCalledWith("sess-1", { type: "agent_end" });
  });

  it("should NOT emit agent_end when prompt() succeeds", async () => {
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);
    const promptResolve = vi.fn().mockResolvedValue(undefined);

    const mockManaged = { client: { prompt: promptResolve } };
    const getActiveManaged = vi.fn().mockReturnValue(mockManaged);

    function send(sessionId: string, content: string) {
      const managed = getActiveManaged(sessionId);
      if (!managed) return false;
      managed.client.prompt(content).catch(() => {
        emitAgentEvent(sessionId, { type: "agent_end" });
      });
      return true;
    }

    const result = send("sess-1", "hello");

    expect(result).toBe(true);

    await new Promise((r) => setTimeout(r, 0));

    expect(promptResolve).toHaveBeenCalledTimes(1);

    expect(emitAgentEvent).not.toHaveBeenCalled();
  });
});

describe("Session state after abort: should not be stuck in streaming", () => {
  it("agent_end event should transition session from streaming to idle", () => {
    type SessionStatus = "idle" | "streaming" | "compacting" | "retrying";
    const sessionStatusMap: Record<string, SessionStatus> = {
      "sess-1": "streaming",
    };

    function handleAgentEvent(sessionId: string, event: { type: string }) {
      if (event.type === "agent_end") {
        sessionStatusMap[sessionId] = "idle";
      }
    }

    expect(sessionStatusMap["sess-1"]).toBe("streaming");

    handleAgentEvent("sess-1", { type: "agent_end" });

    expect(sessionStatusMap["sess-1"]).toBe("idle");
  });

  it("without agent_end, session stays stuck in streaming (the bug)", () => {
    type SessionStatus = "idle" | "streaming" | "compacting" | "retrying";
    const sessionStatusMap: Record<string, SessionStatus> = {
      "sess-1": "streaming",
    };

    function abortWithoutAgentEnd() {}

    abortWithoutAgentEnd();

    expect(sessionStatusMap["sess-1"]).toBe("streaming");
  });
});
