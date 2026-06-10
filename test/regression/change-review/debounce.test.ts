import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall, onReconnect: () => {} },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
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

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

vi.mock("../../../src/mainview/stores/use-git-store", () => ({
  useGitStore: {
    getState: vi.fn(() => ({ clearDiff: vi.fn() })),
  },
}));

import { useChangeReviewStore } from "../../../src/mainview/stores/use-change-review-store";

function resetStore() {
  useChangeReviewStore.setState({
    open: false,
    changes: [],
    loading: false,
    selectedPath: null,
  });
}

/**
 * Regression: fetchPending should dedup concurrent calls.
 *
 * 旧的 debounce 行为（按 setTimeout 延迟 2-3s）已重构为 in-flight promise
 * dedup：当一个 fetchPending 正在执行时，后续调用共享同一 promise，避免
 * session 切换时三重触发 RPC。该文件保护这一行为。
 */
describe("fetchPending in-flight dedup", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("concurrent fetchPending calls share a single RPC", async () => {
    mockCall.mockResolvedValue([]);

    const p1 = useChangeReviewStore.getState().fetchPending();
    const p2 = useChangeReviewStore.getState().fetchPending();
    const p3 = useChangeReviewStore.getState().fetchPending();

    await Promise.all([p1, p2, p3]);

    expect(mockCall).toHaveBeenCalledTimes(1);
  });

  it("subsequent fetchPending after the first resolves triggers a new RPC", async () => {
    mockCall.mockResolvedValue([]);

    await useChangeReviewStore.getState().fetchPending();
    await useChangeReviewStore.getState().fetchPending();

    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("writes the resolved changes (enriched with empty content fallbacks) to the store", async () => {
    const changes = [
      {
        turnIndex: 0,
        path: "src/a.ts",
        fileStatus: "modified" as const,
        status: "pending" as const,
        timestamp: 1234,
        oldContent: null,
        newContent: null,
      },
    ];
    // fetchPending 内部会把 null 字段 enrich 为 ""，便于 InlineDiffViewer 渲染
    const enriched = changes.map((c) => ({
      ...c,
      oldContent: "",
      newContent: "",
    }));
    mockCall.mockResolvedValueOnce(changes);

    await useChangeReviewStore.getState().fetchPending();

    expect(useChangeReviewStore.getState().changes).toEqual(enriched);
  });

  it("clears loading state even if RPC rejects", async () => {
    mockCall.mockRejectedValueOnce(new Error("rpc fail"));

    await useChangeReviewStore.getState().fetchPending();

    expect(useChangeReviewStore.getState().loading).toBe(false);
  });
});
