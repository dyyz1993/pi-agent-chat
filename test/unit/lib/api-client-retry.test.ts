/**
 * Regression: api-client.initialize() used to cache a rejected initPromise,
 * so after one transient WebSocket failure every later initialize() returned
 * the same rejection without opening a new socket — login retry could never
 * recover until a page refresh (field-verified on the replay deployment).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connectImpl: (): Promise<void> => Promise.resolve(),
}));

const transportInstances: Array<{
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("@dyyz1993/rpc-core", () => {
  class FakeWebSocketTransport {
    connect = vi.fn(() => state.connectImpl());
    close = vi.fn();
    isConnected = vi.fn(() => false);
    constructor() {
      transportInstances.push(this);
    }
  }
  class FakeIPCTransport {}
  return {
    WebSocketTransport: FakeWebSocketTransport,
    IPCTransport: FakeIPCTransport,
    createTypedClient: vi.fn(() => ({})),
  };
});

vi.mock("../../../src/mainview/lib/proxy", () => ({
  tryEnable: vi.fn(async () => false),
}));

describe("api-client initialize failure recovery", () => {
  let apiClient: import("../../../src/mainview/lib/api-client").ApiClient;

  beforeEach(async () => {
    vi.resetModules();
    // test/setup.ts globally mocks this module for every test file; the module
    // under test IS api-client, so opt out before the dynamic import.
    vi.doUnmock("../../../src/mainview/lib/api-client");
    transportInstances.length = 0;
    state.connectImpl = () => Promise.resolve();
    ({ apiClient } = await import("../../../src/mainview/lib/api-client"));
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the cached initPromise on connect failure so retry opens a new socket", async () => {
    // first connect attempt rejects (e.g. transient server hiccup)
    state.connectImpl = () => Promise.reject(new Error("WS connect failed"));
    await expect(apiClient.initialize()).rejects.toThrow("WS connect failed");

    // the failed transport must be discarded, and the cached promise cleared
    expect(transportInstances.length).toBe(1);
    expect(transportInstances[0]!.close).toHaveBeenCalled();

    // retry: a brand-new transport is created and connect is attempted again
    state.connectImpl = () => Promise.resolve();
    await apiClient.initialize();

    expect(transportInstances.length).toBe(2);
    expect(transportInstances[1]!.connect).toHaveBeenCalled();
  });
});
