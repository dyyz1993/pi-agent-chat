import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({ activeSessionId: "test-session" }),
    subscribe: vi.fn(),
  },
}));

import { useChatNavStore } from "../src/mainview/stores/use-chat-nav-store";

beforeEach(() => {
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

describe("useChatNavStore", () => {
  it("has correct initial state", () => {
    const s = useChatNavStore.getState();
    expect(s.activeIdBySession).toEqual({});
    expect(s.batchModeBySession).toEqual({});
  });

  it("setActive sets activeId for current session", () => {
    useChatNavStore.getState().setActive("msg-1");
    expect(useChatNavStore.getState().activeIdBySession["test-session"]).toBe("msg-1");
  });

  it("toggleItemSelect adds item to selection", () => {
    useChatNavStore.getState().toggleItemSelect("item-a");
    expect(useChatNavStore.getState().isItemSelected("item-a")).toBe(true);
    expect(useChatNavStore.getState().getSelectedCount()).toBe(1);
    expect(useChatNavStore.getState().hasSelection()).toBe(true);
  });

  it("toggleItemSelect removes item on second toggle", () => {
    useChatNavStore.getState().toggleItemSelect("item-a");
    useChatNavStore.getState().toggleItemSelect("item-a");
    expect(useChatNavStore.getState().isItemSelected("item-a")).toBe(false);
    expect(useChatNavStore.getState().getSelectedCount()).toBe(0);
  });

  it("selectItemRange selects both fromId and toId", () => {
    useChatNavStore.getState().selectItemRange("item-1", "item-3");
    expect(useChatNavStore.getState().isItemSelected("item-1")).toBe(true);
    expect(useChatNavStore.getState().isItemSelected("item-3")).toBe(true);
    expect(useChatNavStore.getState().getSelectedCount()).toBe(2);
  });

  it("isItemSelected returns false for unselected item", () => {
    expect(useChatNavStore.getState().isItemSelected("nonexistent")).toBe(false);
  });

  it("toggleTurnSelect selects turn and all its items", () => {
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["i1", "i2", "i3"]);
    expect(useChatNavStore.getState().isTurnSelected("turn-1")).toBe(true);
    expect(useChatNavStore.getState().isItemSelected("i1")).toBe(true);
    expect(useChatNavStore.getState().isItemSelected("i2")).toBe(true);
    expect(useChatNavStore.getState().isItemSelected("i3")).toBe(true);
  });

  it("toggleTurnSelect deselects turn and items on second call", () => {
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["i1", "i2"]);
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["i1", "i2"]);
    expect(useChatNavStore.getState().isTurnSelected("turn-1")).toBe(false);
    expect(useChatNavStore.getState().isItemSelected("i1")).toBe(false);
  });

  it("clearSelection clears all selected items and turns", () => {
    useChatNavStore.getState().toggleItemSelect("item-a");
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["i1"]);
    useChatNavStore.getState().clearSelection();
    expect(useChatNavStore.getState().hasSelection()).toBe(false);
    expect(useChatNavStore.getState().getSelectedCount()).toBe(0);
  });

  it("getSelectedCount and hasSelection return correct values", () => {
    expect(useChatNavStore.getState().getSelectedCount()).toBe(0);
    expect(useChatNavStore.getState().hasSelection()).toBe(false);

    useChatNavStore.getState().toggleItemSelect("x");
    expect(useChatNavStore.getState().getSelectedCount()).toBe(1);
    expect(useChatNavStore.getState().hasSelection()).toBe(true);
  });

  it("collapseAll makes isTurnCollapsed return true", () => {
    useChatNavStore.getState().collapseAll();
    expect(useChatNavStore.getState().isTurnCollapsed("any-turn")).toBe(true);
  });

  it("expandAll makes isTurnCollapsed return false", () => {
    useChatNavStore.getState().collapseAll();
    useChatNavStore.getState().expandAll();
    expect(useChatNavStore.getState().isTurnCollapsed("any-turn")).toBe(false);
  });

  it("openRollbackOverlay and closeRollbackOverlay manage state", () => {
    useChatNavStore.getState().openRollbackOverlay("code", "item-1");
    const open = useChatNavStore.getState();
    expect(open.rollbackOverlayOpen).toBe(true);
    expect(open.rollbackOverlayType).toBe("code");
    expect(open.rollbackTargetItemId).toBe("item-1");

    useChatNavStore.getState().closeRollbackOverlay();
    const closed = useChatNavStore.getState();
    expect(closed.rollbackOverlayOpen).toBe(false);
    expect(closed.rollbackOverlayType).toBeNull();
    expect(closed.rollbackTargetItemId).toBeNull();
  });

  it("clearSessionUI removes all UI state for a session", () => {
    useChatNavStore.getState().setActive("msg-1");
    useChatNavStore.getState().toggleItemSelect("item-a");

    useChatNavStore.getState().clearSessionUI("test-session");

    const s = useChatNavStore.getState();
    expect(s.activeIdBySession["test-session"]).toBeUndefined();
    expect(s.selectedItemsBySession["test-session"]).toBeUndefined();
  });
});
