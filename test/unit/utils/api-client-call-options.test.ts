import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../../../src/mainview/lib/api-client");

const rpcCall = vi.fn();
const createTypedClient = vi.fn();

vi.mock("@dyyz1993/rpc-core", () => {
  class MockTransport {
    send = vi.fn();
    simulateMessage = vi.fn();
    close = vi.fn();
    isConnected = () => true;
    onMessage = vi.fn();
    onError = vi.fn();
  }

  return {
    createTypedClient,
    IPCTransport: MockTransport,
    WebSocketTransport: MockTransport,
  };
});

describe("apiClient call options", () => {
  beforeEach(() => {
    vi.resetModules();
    rpcCall.mockReset();
    createTypedClient.mockReset();
    rpcCall.mockResolvedValue({ ok: true });
    createTypedClient.mockReturnValue({
      call: rpcCall,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      close: vi.fn(),
    });
  });

  it("passes a per-call timeout only for long-running RPC methods", async () => {
    const { apiClient } = await import("../../../src/mainview/lib/api-client");

    apiClient.initSyncForDesktop();

    await apiClient.call("agent.compact", { sessionId: "session-1" });
    await apiClient.call("agent.getState", { sessionId: "session-1" });

    expect(rpcCall).toHaveBeenNthCalledWith(
      1,
      "agent.compact",
      { sessionId: "session-1" },
      { timeoutMs: 300_000 },
    );
    expect(rpcCall).toHaveBeenNthCalledWith(
      2,
      "agent.getState",
      { sessionId: "session-1" },
      undefined,
    );
    expect(createTypedClient).toHaveBeenCalledTimes(1);
  });
});
