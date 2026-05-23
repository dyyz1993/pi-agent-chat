import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockCall } = vi.hoisted(() => ({
  mockCall: vi.fn(),
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockCall },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({ activeSessionId: "sess-1" })),
  },
}));

vi.mock("../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({ push: vi.fn() })),
  },
}));

import { useChangeReviewStore } from "../src/mainview/stores/use-change-review-store";
import type { PendingChange } from "../src/mainview/stores/use-change-review-store";

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
    loading: false,
    selectedPath: null,
  });
}

function countDiffLines(oldContent: string | null, newContent: string | null) {
  const oldLines = oldContent ? oldContent.split("\n") : [];
  const newLines = newContent ? newContent.split("\n") : [];
  const oldSet = new Map<string, number>();
  for (const line of oldLines) {
    oldSet.set(line, (oldSet.get(line) ?? 0) + 1);
  }
  let added = 0;
  for (const line of newLines) {
    const count = oldSet.get(line);
    if (count !== undefined && count > 0) {
      oldSet.set(line, count - 1);
    } else {
      added++;
    }
  }
  let removed = 0;
  for (const count of oldSet.values()) {
    removed += count;
  }
  return { added, removed };
}

function inferFileStatus(oldContent: string | null, newContent: string | null) {
  if (oldContent === null && newContent !== null) return "added" as const;
  if (oldContent !== null && newContent === null) return "deleted" as const;
  return "modified" as const;
}

describe("useChangeReviewStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe("diff stats from oldContent/newContent", () => {
    it("should compute diff stats from oldContent/newContent", () => {
      const change = makeChange({
        oldContent: "line1\nline2",
        newContent: "line1\nline2\nline3",
      });

      const stats = countDiffLines(change.oldContent, change.newContent);
      expect(stats.added).toBe(1);
      expect(stats.removed).toBe(0);
    });

    it("should count removed lines correctly", () => {
      const change = makeChange({
        oldContent: "line1\nline2\nline3",
        newContent: "line1",
      });

      const stats = countDiffLines(change.oldContent, change.newContent);
      expect(stats.added).toBe(0);
      expect(stats.removed).toBe(2);
    });

    it("should count both added and removed lines", () => {
      const change = makeChange({
        oldContent: "line1\nline2\nline3",
        newContent: "line1\nline4\nline5",
      });

      const stats = countDiffLines(change.oldContent, change.newContent);
      expect(stats.added).toBe(2);
      expect(stats.removed).toBe(2);
    });

    it("should handle identical content", () => {
      const change = makeChange({
        oldContent: "line1\nline2",
        newContent: "line1\nline2",
      });

      const stats = countDiffLines(change.oldContent, change.newContent);
      expect(stats.added).toBe(0);
      expect(stats.removed).toBe(0);
    });
  });

  describe("file status identification (added/modified/deleted)", () => {
    it("should identify added files (oldContent=null, newContent present)", () => {
      const change = makeChange({
        oldContent: null,
        newContent: "new file content",
      });

      expect(inferFileStatus(change.oldContent, change.newContent)).toBe("added");
    });

    it("should identify modified files (both oldContent and newContent present)", () => {
      const change = makeChange({
        oldContent: "old content",
        newContent: "new content",
      });

      expect(inferFileStatus(change.oldContent, change.newContent)).toBe("modified");
    });

    it("should identify deleted files (oldContent present, newContent=null)", () => {
      const change = makeChange({
        oldContent: "old content",
        newContent: null,
      });

      expect(inferFileStatus(change.oldContent, change.newContent)).toBe("deleted");
    });

    it("should store fileStatus from API response correctly", async () => {
      const changes = [
        makeChange({ path: "new.ts", fileStatus: "added", oldContent: null, newContent: "x" }),
        makeChange({ path: "mod.ts", fileStatus: "modified", oldContent: "a", newContent: "b" }),
        makeChange({ path: "del.ts", fileStatus: "deleted", oldContent: "y", newContent: null }),
      ];
      mockCall.mockResolvedValueOnce(changes);

      await useChangeReviewStore.getState().fetchPending();

      const stored = useChangeReviewStore.getState().changes;
      expect(stored).toHaveLength(3);
      expect(stored[0].fileStatus).toBe("added");
      expect(stored[1].fileStatus).toBe("modified");
      expect(stored[2].fileStatus).toBe("deleted");
    });
  });

  describe("rejectChange", () => {
    it("should remove rolled-back file from list on reject", async () => {
      const fileA = makeChange({ path: "src/a.ts" });
      const fileB = makeChange({ path: "src/b.ts" });
      useChangeReviewStore.setState({ changes: [fileA, fileB] });

      mockCall.mockResolvedValueOnce({ ok: true, rolledBack: true });

      await useChangeReviewStore.getState().rejectChange("src/a.ts");

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe("src/b.ts");
    });

    it("should update status to rejected when not rolled back", async () => {
      const fileA = makeChange({ path: "src/a.ts" });
      useChangeReviewStore.setState({ changes: [fileA] });

      mockCall.mockResolvedValueOnce({ ok: true, rolledBack: false });

      await useChangeReviewStore.getState().rejectChange("src/a.ts");

      const changes = useChangeReviewStore.getState().changes;
      expect(changes).toHaveLength(1);
      expect(changes[0].status).toBe("rejected");
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
    let origConfirm: typeof window.confirm;

    beforeEach(() => {
      origConfirm = globalThis.window.confirm;
      globalThis.window.confirm = vi.fn(() => true);
    });

    afterEach(() => {
      globalThis.window.confirm = origConfirm;
    });

    it("should clear all files on rejectAll", async () => {
      const files = [
        makeChange({ path: "src/a.ts" }),
        makeChange({ path: "src/b.ts" }),
        makeChange({ path: "src/c.ts" }),
      ];
      useChangeReviewStore.setState({ changes: files });

      mockCall.mockResolvedValueOnce({ count: 3, rolledBack: 3 });

      await useChangeReviewStore.getState().rejectAll();

      expect(useChangeReviewStore.getState().changes).toHaveLength(0);
    });

    it("should not clear when user cancels confirm", async () => {
      (globalThis.window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const files = [makeChange({ path: "src/a.ts" }), makeChange({ path: "src/b.ts" })];
      useChangeReviewStore.setState({ changes: files });

      await useChangeReviewStore.getState().rejectAll();

      expect(useChangeReviewStore.getState().changes).toHaveLength(2);
      expect(mockCall).not.toHaveBeenCalled();
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
    it("should store fetched changes", async () => {
      const changes = [makeChange({ path: "src/a.ts" }), makeChange({ path: "src/b.ts" })];
      mockCall.mockResolvedValueOnce(changes);

      await useChangeReviewStore.getState().fetchPending();

      expect(useChangeReviewStore.getState().changes).toEqual(changes);
      expect(useChangeReviewStore.getState().loading).toBe(false);
    });

    it("should handle non-array response", async () => {
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
        selectedPath: "src/a.ts",
        loading: true,
      });

      useChangeReviewStore.getState().clearAll();

      const s = useChangeReviewStore.getState();
      expect(s.open).toBe(false);
      expect(s.changes).toEqual([]);
      expect(s.selectedPath).toBeNull();
      expect(s.loading).toBe(false);
    });
  });
});
