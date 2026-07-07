/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  abortOperation,
  followUpOperation,
  sendPromptOperation,
  steerOperation,
} from "../../../src/shared/agent/agent-client-lifecycle-operations";

describe("agent client lifecycle operations", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends prompts after ensuring a managed client", async () => {
    const managed = {
      client: { prompt: vi.fn().mockResolvedValue(undefined) },
      info: { status: "idle" },
      lastActiveAt: 0,
    };

    await expect(
      sendPromptOperation({
        sessionId: "sess-1",
        content: "hello",
        getActiveManaged: () => null,
        ensureManagedClient: vi.fn().mockResolvedValue(managed),
        isClientAlive: vi.fn(),
        cleanupDeadClient: vi.fn(),
        emitAgentEnd: vi.fn(),
        now: () => 123,
      }),
    ).resolves.toBe(true);

    expect(managed.client.prompt).toHaveBeenCalledWith("hello", undefined);
    expect(managed.lastActiveAt).toBe(123);
  });

  it("rejects ordinary prompts while a client is streaming", async () => {
    const managed = {
      client: { prompt: vi.fn().mockResolvedValue(undefined) },
      info: { status: "streaming" },
      lastActiveAt: 0,
    };

    await expect(
      sendPromptOperation({
        sessionId: "sess-1",
        content: "hello",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn(),
        cleanupDeadClient: vi.fn(),
        emitAgentEnd: vi.fn(),
      }),
    ).rejects.toThrow(/follow-up or steer/);

    expect(managed.client.prompt).not.toHaveBeenCalled();
  });

  it("cleans up dead clients when prompt rejects and health check fails", async () => {
    const managed = {
      client: { prompt: vi.fn().mockRejectedValue(new Error("provider timeout")) },
      info: { status: "idle" },
      lastActiveAt: 0,
    };
    const cleanupDeadClient = vi.fn();
    const emitAgentEnd = vi.fn();

    await expect(
      sendPromptOperation({
        sessionId: "sess-1",
        content: "hello",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn().mockResolvedValue(false),
        cleanupDeadClient,
        emitAgentEnd,
      }),
    ).rejects.toThrow("provider timeout");

    expect(cleanupDeadClient).toHaveBeenCalledWith("sess-1", "prompt failed: provider timeout");
    expect(emitAgentEnd).not.toHaveBeenCalled();
  });

  it("emits agent_end with the prompt error after prompt rejects when the client is still alive", async () => {
    const managed = {
      client: { prompt: vi.fn().mockRejectedValue(new Error("transient")) },
      info: { status: "idle" },
      lastActiveAt: 0,
    };
    const emitAgentEnd = vi.fn().mockResolvedValue(undefined);

    await expect(
      sendPromptOperation({
        sessionId: "sess-1",
        content: "hello",
        getActiveManaged: () => managed,
        ensureManagedClient: vi.fn(),
        isClientAlive: vi.fn().mockResolvedValue(true),
        cleanupDeadClient: vi.fn(),
        emitAgentEnd,
      }),
    ).rejects.toThrow("transient");

    expect(emitAgentEnd).toHaveBeenCalledWith("sess-1", "transient");
  });

  it("routes steer and follow-up calls without creating a client", () => {
    const managed = {
      client: {
        steer: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn().mockResolvedValue(undefined),
      },
    };

    expect(
      steerOperation({
        sessionId: "sess-1",
        content: "steer",
        getActiveManaged: () => managed,
      }),
    ).toBe(true);
    expect(
      followUpOperation({
        sessionId: "sess-1",
        content: "next",
        getActiveManaged: () => managed,
      }),
    ).toBe(true);
    expect(managed.client.steer).toHaveBeenCalledWith("steer", undefined);
    expect(managed.client.followUp).toHaveBeenCalledWith("next", undefined);
  });

  it("aborts, clears streaming state, and emits agent_end", async () => {
    const managed = {
      client: { abort: vi.fn().mockRejectedValue(new Error("already ended")) },
      info: { status: "streaming" },
      lastActiveAt: 0,
    };
    const broadcastIdle = vi.fn();
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);

    await expect(
      abortOperation({
        sessionId: "sess-1",
        getActiveManaged: () => managed,
        broadcastIdle,
        emitAgentEvent,
        now: () => 456,
      }),
    ).resolves.toBe(true);

    expect(managed.info.status).toBe("idle");
    expect(managed.lastActiveAt).toBe(456);
    expect(broadcastIdle).toHaveBeenCalledWith("sess-1");
    expect(emitAgentEvent).toHaveBeenCalledWith("sess-1", { type: "agent_end" });
  });

  it("forces local idle when abort never returns", async () => {
    vi.useFakeTimers();

    const managed = {
      client: { abort: vi.fn(() => new Promise<void>(() => {})) },
      info: { status: "streaming" },
      lastActiveAt: 0,
    };
    const broadcastIdle = vi.fn();
    const emitAgentEvent = vi.fn().mockResolvedValue(undefined);

    const promise = abortOperation({
      sessionId: "sess-remote",
      getActiveManaged: () => managed,
      broadcastIdle,
      emitAgentEvent,
      abortTimeoutMs: 1,
      now: () => 789,
    });

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe(true);

    expect(managed.info.status).toBe("idle");
    expect(managed.lastActiveAt).toBe(789);
    expect(broadcastIdle).toHaveBeenCalledWith("sess-remote");
    expect(emitAgentEvent).toHaveBeenCalledWith("sess-remote", { type: "agent_end" });
  });
});
