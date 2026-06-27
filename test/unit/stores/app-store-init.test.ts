import { describe, expect, it, vi } from "vitest";

const { mockInitialize, mockGetTransport, mockIsConnected, mockOnConnectionChange } = vi.hoisted(
  () => ({
    mockInitialize: vi.fn(),
    mockGetTransport: vi.fn(() => "websocket"),
    mockIsConnected: vi.fn(() => false),
    mockOnConnectionChange: vi.fn(),
  }),
);

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    initialize: mockInitialize,
    getTransport: mockGetTransport,
    isConnected: mockIsConnected,
    onConnectionChange: mockOnConnectionChange,
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { useAppStore } from "../../../src/mainview/stores/use-app-store";

describe("useAppStore initializeConnection", () => {
  it("single-flights concurrent startup calls", async () => {
    let resolveInitialize!: () => void;
    mockInitialize.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInitialize = resolve;
        }),
    );

    const first = useAppStore.getState().initializeConnection() as unknown as Promise<void>;
    const second = useAppStore.getState().initializeConnection() as unknown as Promise<void>;

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockOnConnectionChange).toHaveBeenCalledTimes(1);

    resolveInitialize();
    await Promise.all([first, second]);

    expect(useAppStore.getState().ready).toBe(true);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });
});
