import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall, onReconnect: () => {} },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: vi.fn(() => ({ activeSessionId: "sess-1" })),
  },
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

import { useChangeReviewStore } from "../../../src/mainview/stores/use-change-review-store";
import type { PendingChange } from "../../../src/mainview/stores/use-change-review-store";

function makeChange(overrides: Partial<PendingChange> = {}): PendingChange {
  return {
    turnIndex: 0,
    path: "src/a.ts",
    fileStatus: "modified",
    status: "pending",
    timestamp: Date.now(),
    oldContent: "line1\nline2",
    newContent: "line1\nline2\nline3",
    ...overrides,
  };
}

function resetStore() {
  useChangeReviewStore.setState({
    open: false,
    changes: [],
    approvals: [],
    loading: false,
    selectedPath: null,
    processingPaths: new Set(),
  });
}

describe("useChangeReviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe("file status from review.pending", () => {
    it("should store fileStatus from API response correctly", async () => {
      const changes = [
        makeChange({ path: "new.ts", fileStatus: "added", oldContent: null, newContent: "x" }),
        makeChange({ path: "mod.ts", fileStatus: "modified", oldContent: "a", newContent: "b" }),
        makeChange({ path: "del.ts", fileStatus: "deleted", oldContent: "y", newContent: null }),
      ];
      mockCall.mockResolvedValueOnce([]);
      mockCall.mockResolvedValueOnce(changes);

      await useChangeReviewStore.getState().fetchPending();

      const stored = useChangeReviewStore.getState().changes;
      expect(stored).toHaveLength(3);
      expect(stored.find((item) => item.path === "new.ts")?.fileStatus).toBe("added");
      expect(stored.find((item) => item.path === "mod.ts")?.fileStatus).toBe("modified");
      expect(stored.find((item) => item.path === "del.ts")?.fileStatus).toBe("deleted");
    });
  });

  describe("rejectChange", () => {
    it("should remove rolled-back file from list on reject", async () => {
      const fileA = makeChange({ path: "src/a.ts" });
      const fileB = makeChange({ path: "src/b.ts" });
      useChangeReviewStore.setState({ changes: [fileA, fileB] });

      mockCall.mockResolvedValueOnce({ ok: true, rolledBack: true });
      mockCall.mockResolvedValueOnce([]);
      mockCall.mockResolvedValueOnce([fileB]);

      await useChangeReviewStore.getState().rejectChange("src/a.ts");

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe("src/b.ts");
    });

    it("should keep rejected approval separate from pending diff list", async () => {
      const fileA = makeChange({ path: "src/a.ts" });
      useChangeReviewStore.setState({ changes: [fileA] });

      mockCall.mockResolvedValueOnce({ ok: true, rolledBack: false });
      mockCall.mockResolvedValueOnce([{ path: "src/a.ts", status: "rejected", timestamp: Date.now(), turnIndex: -1 }]);
      mockCall.mockResolvedValueOnce([]);

      await useChangeReviewStore.getState().rejectChange("src/a.ts");

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(0);
      expect(useChangeReviewStore.getState().approvals).toHaveLength(1);
      expect(useChangeReviewStore.getState().approvals[0].status).toBe("rejected");
    });

    it("should handle reject error gracefully", async () => {
      const fileA = makeChange({ path: "src/a.ts" });
      const fileB = makeChange({ path: "src/b.ts" });
      useChangeReviewStore.setState({ changes: [fileA, fileB] });

      mockCall.mockRejectedValueOnce(new Error("something went wrong"));

      await useChangeReviewStore.getState().rejectChange("src/a.ts");

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(2);
      expect(changes[0].path).toBe("src/a.ts");
      expect(changes[1].path).toBe("src/b.ts");
    });

    it("should not remove file when ok=false", async () => {
      const fileA = makeChange({ path: "src/a.ts" });
      useChangeReviewStore.setState({ changes: [fileA] });

      mockCall.mockResolvedValueOnce({ ok: false, error: "denied" });

      await useChangeReviewStore.getState().rejectChange("src/a.ts");

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(1);
    });
  });

  describe("rejectAll", () => {
    it("should clear all files on rejectAll", async () => {
      const files = [
        makeChange({ path: "src/a.ts" }),
        makeChange({ path: "src/b.ts" }),
        makeChange({ path: "src/c.ts" }),
      ];
      useChangeReviewStore.setState({ changes: files });

      mockCall.mockResolvedValueOnce({ count: 3, rolledBack: 3 });
      mockCall.mockResolvedValueOnce([]);
      mockCall.mockResolvedValueOnce([]);

      await useChangeReviewStore.getState().rejectAll();

      expect(useChangeReviewStore.getState().changes).toHaveLength(0);
    });

    it("should handle rejectAll error gracefully", async () => {
      const files = [makeChange({ path: "src/a.ts" }), makeChange({ path: "src/b.ts" })];
      useChangeReviewStore.setState({ changes: files });

      mockCall.mockRejectedValueOnce(new Error("server error"));

      await useChangeReviewStore.getState().rejectAll();

      expect(useChangeReviewStore.getState().changes).toHaveLength(2);
    });

    it("should do nothing when no pending changes", async () => {
      useChangeReviewStore.setState({
        changes: [makeChange({ path: "src/a.ts", status: "approved" })],
      });

      await useChangeReviewStore.getState().rejectAll();

      expect(mockCall).not.toHaveBeenCalled();
    });
  });

  describe("fetchPending", () => {
    it("should store approvals separately and only render pending changes", async () => {
      mockCall.mockResolvedValueOnce([
        { path: "src/approved.ts", status: "approved", timestamp: 10, turnIndex: -1 },
      ]);
      mockCall.mockResolvedValueOnce([makeChange({ path: "src/pending.ts", timestamp: 20 })]);

      await useChangeReviewStore.getState().fetchPending();

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe("src/pending.ts");
      expect(changes[0].status).toBe("pending");
      expect(useChangeReviewStore.getState().approvals).toEqual([
        { path: "src/approved.ts", status: "approved", timestamp: 10, turnIndex: -1 },
      ]);
    });

    it("should store fetched changes", async () => {
      const changes = [makeChange({ path: "src/a.ts" }), makeChange({ path: "src/b.ts" })];
      mockCall.mockResolvedValueOnce([]);
      mockCall.mockResolvedValueOnce(changes);

      await useChangeReviewStore.getState().fetchPending();

      expect(useChangeReviewStore.getState().changes).toEqual(changes);
      expect(useChangeReviewStore.getState().loading).toBe(false);
    });

    it("should handle non-array response", async () => {
      mockCall.mockResolvedValueOnce(null);
      mockCall.mockResolvedValueOnce(null);

      await useChangeReviewStore.getState().fetchPending();

      expect(useChangeReviewStore.getState().changes).toEqual([]);
      expect(useChangeReviewStore.getState().loading).toBe(false);
    });

    it("should handle fetch error", async () => {
      mockCall.mockRejectedValueOnce(new Error("network error"));

      await useChangeReviewStore.getState().fetchPending();

      expect(useChangeReviewStore.getState().changes).toEqual([]);
      expect(useChangeReviewStore.getState().loading).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("should reset all state", () => {
      useChangeReviewStore.setState({
        open: true,
        changes: [makeChange()],
        approvals: [{ path: "src/a.ts", status: "approved", timestamp: Date.now(), turnIndex: -1 }],
        selectedPath: "src/a.ts",
        loading: true,
      });

      useChangeReviewStore.getState().clearAll();

      const s = useChangeReviewStore.getState();
      expect(s.open).toBe(false);
      expect(s.changes).toEqual([]);
      expect(s.approvals).toEqual([]);
      expect(s.selectedPath).toBeNull();
      expect(s.loading).toBe(false);
    });
  });
});
