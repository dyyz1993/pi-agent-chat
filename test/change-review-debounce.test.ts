import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "sess-1",
      sessionsByProject: {
        "/proj": [{ sessionId: "sess-1", sessionPath: "/tmp/test.jsonl" }],
      },
    })),
  },
}));

vi.mock("../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: vi.fn(() => ({ clearDiff: vi.fn() })),
  },
}));

import { useChangeReviewStore } from "../src/mainview/stores/use-change-review-store";

function resetStore() {
  useChangeReviewStore.setState({
    open: false,
    changes: [],
    loading: false,
    selectedPath: null,
  });
}

describe("fetchPending debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should only call RPC once when fetchPending is called multiple times within debounce window", async () => {
    mockCall.mockResolvedValue([]);

    useChangeReviewStore.getState().fetchPending();
    useChangeReviewStore.getState().fetchPending();
    useChangeReviewStore.getState().fetchPending();

    await vi.advanceTimersByTimeAsync(3000);

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("should execute a second call after debounce window passes", async () => {
    mockCall.mockResolvedValue([]);

    useChangeReviewStore.getState().fetchPending();
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockCall).toHaveBeenCalledTimes(1);

    useChangeReviewStore.getState().fetchPending();
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("should still update changes correctly after debounce", async () => {
    const changes = [
      {
        turnIndex: 0,
        path: "src/a.ts",
        fileStatus: "modified" as const,
        status: "pending" as const,
        timestamp: Date.now(),
        oldContent: null,
        newContent: null,
      },
    ];
    mockCall.mockResolvedValueOnce(changes);

    useChangeReviewStore.getState().fetchPending();
    await vi.advanceTimersByTimeAsync(3000);

    expect(useChangeReviewStore.getState().changes).toEqual(changes);
  });

  it("should not call RPC if fetchPending is called and re-called within 2s", async () => {
    mockCall.mockResolvedValue([]);

    useChangeReviewStore.getState().fetchPending();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockCall).not.toHaveBeenCalled();

    useChangeReviewStore.getState().fetchPending();
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockCall).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);

    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});
