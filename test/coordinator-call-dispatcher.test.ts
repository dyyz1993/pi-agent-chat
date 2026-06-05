/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { handleCoordinatorCallOperation } from "../src/shared/agent/coordinator-call-dispatcher";

function makeManaged() {
  return {
    _activeSessionId: "sess-1",
    client: {
      channel: vi.fn().mockReturnValue({
        send: vi.fn(),
      }),
    },
  };
}

function makeOptions(overrides: Partial<Parameters<typeof handleCoordinatorCallOperation>[0]> = {}) {
  return {
    sessionId: "sess-1",
    data: { type: "child_event" },
    channelName: "coordinator",
    startInProgress: false,
    broadcastEvent: vi.fn().mockResolvedValue(undefined),
    queueDelegateRequest: vi.fn().mockResolvedValue({ queued: true }),
    handleDelegate: vi.fn().mockResolvedValue({ sessionId: "child", status: "started" }),
    handleDelegateSend: vi.fn().mockResolvedValue({ delivered: true }),
    handleDelegateSync: vi.fn().mockResolvedValue({ sessionId: "child", status: "completed" }),
    handleDelegateStatus: vi.fn().mockResolvedValue({ status: "idle" }),
    handleDelegateList: vi.fn().mockReturnValue({ sessions: [] }),
    handleDelegateStop: vi.fn().mockResolvedValue({ ok: true }),
    handleDelegateFork: vi.fn().mockResolvedValue({ sessionId: "fork" }),
    handleClearStopped: vi.fn().mockReturnValue({ cleared: [] }),
    handleRemove: vi.fn().mockReturnValue({ removed: true }),
    findResponseManaged: vi.fn().mockReturnValue({ managed: makeManaged() }),
    ...overrides,
  };
}

describe("coordinator call dispatcher", () => {
  it("broadcasts non-call coordinator events", async () => {
    const options = makeOptions({
      data: { type: "subagent_update", value: 1 },
    });

    await handleCoordinatorCallOperation(options);

    expect(options.broadcastEvent).toHaveBeenCalledWith(
      "coordinator.event",
      { sessionId: "sess-1", event: { type: "subagent_update", value: 1 } },
      { sessionId: "sess-1" },
    );
  });

  it("queues delegate calls while start is in progress and replies with invokeId", async () => {
    const managed = makeManaged();
    const options = makeOptions({
      startInProgress: true,
      data: {
        __call: "session_delegate",
        invokeId: "invoke-1",
        task: "work",
      },
      queueDelegateRequest: vi.fn().mockResolvedValue({ sessionId: "child", status: "started" }),
      findResponseManaged: vi.fn().mockReturnValue({ managed }),
    });

    await handleCoordinatorCallOperation(options);

    expect(options.queueDelegateRequest).toHaveBeenCalledWith({
      sessionId: "sess-1",
      msg: options.data,
      channelName: "coordinator",
    });
    const send = managed.client.channel("coordinator").send;
    expect(send).toHaveBeenCalledWith({
      sessionId: "child",
      status: "started",
      invokeId: "invoke-1",
    });
  });

  it("routes direct calls to handlers and wraps handler errors", async () => {
    const managed = makeManaged();
    const options = makeOptions({
      data: {
        __call: "session_delegate_status",
        invokeId: "invoke-2",
        sessionId: "child",
      },
      handleDelegateStatus: vi.fn().mockRejectedValue(new Error("offline")),
      findResponseManaged: vi.fn().mockReturnValue({ managed }),
    });

    await handleCoordinatorCallOperation(options);

    const send = managed.client.channel("coordinator").send;
    expect(send).toHaveBeenCalledWith({ error: "offline", invokeId: "invoke-2" });
  });
});
