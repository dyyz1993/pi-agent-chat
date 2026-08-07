/**
 * @vitest-environment node
 *
 * Tests that apiClient.call() rejects pending RPC promises when the
 * WebSocket connection drops, instead of waiting for the full 60s
 * RPC timeout.
 */
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
    connect = vi.fn().mockResolvedValue(undefined);
    onDisconnect = vi.fn();
  }
  return {
    createTypedClient,
    IPCTransport: MockTransport,
    WebSocketTransport: MockTransport,
  };
});

vi.mock("../../../src/mainview/lib/auth", () => ({
  resolveAuthToken: () => "test-token",
  appendToken: (url: string) => url,
}));

globalThis.window = undefined as unknown as Window & typeof globalThis;

describe("apiClient disconnect behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    rpcCall.mockReset();
    createTypedClient.mockReset();
  });

  it("onConnectionChange fires when connection status changes", async () => {
    // Arrange: rpcCall returns a never-resolving promise
    rpcCall.mockReturnValue(new Promise(() => {}));
    createTypedClient.mockReturnValue({
      call: rpcCall,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      dispose: vi.fn(),
    });

    const { apiClient } = await import("../../../src/mainview/lib/api-client");
    apiClient.initSyncForDesktop();

    const statuses: string[] = [];
    apiClient.onConnectionChange((status) => statuses.push(status));

    // Act: trigger disconnect
    apiClient.testSetConnectionStatus("disconnected");

    // Assert
    expect(statuses).toContain("disconnected");
  });

  it("pending call() rejects when connection drops (not after 60s)", async () => {
    rpcCall.mockReturnValue(new Promise(() => {})); // never resolves
    createTypedClient.mockReturnValue({
      call: rpcCall,
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      dispose: vi.fn(),
    });

    const { apiClient } = await import("../../../src/mainview/lib/api-client");
    apiClient.initSyncForDesktop();

    // Start a call that will hang
    const callPromise = apiClient.call("agent.getFullMessages", { sessionId: "test" });
    await new Promise((r) => setTimeout(r, 50)); // let it register

    // Trigger disconnect
    apiClient.testSetConnectionStatus("disconnected");

    // Should reject quickly (within 1s, not 60s)
    const start = Date.now();
    let errorMsg = "";
    try {
      await Promise.race([
        callPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("TEST_TIMEOUT")), 2000)),
      ]);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
    }
    const elapsed = Date.now() - start;

    expect(errorMsg).toContain("disconnect");
    expect(elapsed).toBeLessThan(2000);
  });
});
