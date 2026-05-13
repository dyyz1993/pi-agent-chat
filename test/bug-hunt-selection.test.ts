import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({ activeSessionId: "test-session" }),
    subscribe: vi.fn(),
  },
}));

import { useTurnStore } from "../src/mainview/stores/use-turn-store";
import { useChatNavStore } from "../src/mainview/stores/use-chat-nav-store";

beforeEach(() => {
  useTurnStore.setState({
    selectedMessageIdsBySession: {},
    collapsedMessageIdsBySession: {},
    isMultiSelectModeBySession: {},
    selectedNavIdBySession: {},
    navAnchorBySession: {},
  });
  useChatNavStore.setState({
    activeIdBySession: {},
    selectedItemsBySession: {},
    selectedTurnsBySession: {},
    batchModeBySession: {},
    pendingActionBySession: {},
    collapsedTurnsBySession: {},
    rollbackOverlayOpen: false,
    rollbackOverlayType: null,
    rollbackTargetItemId: null,
  });
});

// ─── Bug Area 3: collapseAll then toggleTurnCollapse corrupts state ───

describe("Bug: toggleTurnCollapse after collapseAll corrupts state", () => {
  it("reproduces the bug — new Set('all') iterates string characters instead of being treated as all-collapsed", () => {
    useChatNavStore.getState().collapseAll();
    expect(useChatNavStore.getState().isTurnCollapsed("turn-1")).toBe(true);

    useChatNavStore.getState().toggleTurnCollapse("turn-1");

    const collapsed = useChatNavStore.getState().collapsedTurnsBySession["test-session"];

    // After toggling, the state must NOT contain garbage entries like 'a' or 'l'
    if (collapsed instanceof Set) {
      expect(collapsed.has("a")).toBe(false);
      expect(collapsed.has("l")).toBe(false);
    }

    // Other turns should still be collapsed
    expect(useChatNavStore.getState().isTurnCollapsed("turn-2")).toBe(true);
  });
});

// ─── Bug Area 4: selectMessageRange with negative index ───

describe("Bug: selectMessageRange with negative index adds undefined to Set", () => {
  it("reproduces the bug — negative fromIndex adds undefined to selection set", () => {
    const ids = ["a", "b", "c"];
    useTurnStore.getState().selectMessageRange(-1, 1, ids);

    const selected = useTurnStore.getState().selectedMessageIdsBySession["test-session"];

    // No undefined should ever be in the selection
    for (const id of selected ?? []) {
      expect(typeof id).toBe("string");
      expect(id).not.toBe("undefined");
      expect(ids).toContain(id);
    }

    // Should only select valid indices: 0 and 1 → "a", "b"
    expect([...selected!].sort()).toEqual(["a", "b"]);
  });

  it("handles negative toIndex correctly", () => {
    const ids = ["a", "b", "c"];
    useTurnStore.getState().selectMessageRange(1, -3, ids);

    const selected = useTurnStore.getState().selectedMessageIdsBySession["test-session"];

    for (const id of selected ?? []) {
      expect(typeof id).toBe("string");
      expect(ids).toContain(id);
    }
  });
});

// ─── Bug Area 2: toggleTurnSelect with empty allItemIds ───

describe("Bug: toggleTurnSelect with empty allItemIds creates inconsistent state", () => {
  it("reproduces the bug — turn is selected but hasSelection() is false and batch mode off", () => {
    useChatNavStore.getState().toggleTurnSelect("turn-1", []);

    // This is inconsistent: turn is "selected" but no items and no batch mode
    expect(useChatNavStore.getState().isTurnSelected("turn-1")).toBe(false);
    expect(useChatNavStore.getState().hasSelection()).toBe(false);
    expect(useChatNavStore.getState().getSelectedCount()).toBe(0);
  });

  it("turn with items works correctly", () => {
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["i1", "i2"]);

    expect(useChatNavStore.getState().isTurnSelected("turn-1")).toBe(true);
    expect(useChatNavStore.getState().isItemSelected("i1")).toBe(true);
    expect(useChatNavStore.getState().hasSelection()).toBe(true);
  });
});
