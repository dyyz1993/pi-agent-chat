import { describe, it, expect, beforeEach, vi } from "vitest";

let _activeSessionId: string | null = "test-session";

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({ activeSessionId: _activeSessionId }),
    subscribe: vi.fn(),
  },
}));

import { useChatNavStore } from "../src/mainview/stores/use-chat-nav-store";
import type { BatchAction } from "../src/mainview/types";

beforeEach(() => {
  _activeSessionId = "test-session";
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

describe("useChatNavStore interaction flows", () => {
  it("toggle item select: on → selected, off → deselected, batchMode auto off", () => {
    const s = useChatNavStore.getState();
    s.toggleItemSelect("A");
    expect(s.isItemSelected("A")).toBe(true);
    expect(useChatNavStore.getState().batchModeBySession["test-session"]).toBe(true);

    useChatNavStore.getState().toggleItemSelect("A");
    expect(useChatNavStore.getState().isItemSelected("A")).toBe(false);
    expect(useChatNavStore.getState().batchModeBySession["test-session"]).toBe(false);
  });

  it("batchMode auto on when selecting first item", () => {
    useChatNavStore.getState().toggleItemSelect("item-1");
    expect(useChatNavStore.getState().batchModeBySession["test-session"]).toBe(true);
  });

  it("batchMode auto off when last item deselected", () => {
    useChatNavStore.getState().toggleItemSelect("A");
    useChatNavStore.getState().toggleItemSelect("A");
    expect(useChatNavStore.getState().batchModeBySession["test-session"]).toBe(false);
  });

  it("select range: adds both endpoints", () => {
    useChatNavStore.getState().selectItemRange("item-1", "item-3");
    const s = useChatNavStore.getState();
    expect(s.isItemSelected("item-1")).toBe(true);
    expect(s.isItemSelected("item-3")).toBe(true);
    expect(s.batchModeBySession["test-session"]).toBe(true);
  });

  it("turn select: selects turn and all its items", () => {
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["item-1", "item-2"]);
    const s = useChatNavStore.getState();
    expect(s.isTurnSelected("turn-1")).toBe(true);
    expect(s.isItemSelected("item-1")).toBe(true);
    expect(s.isItemSelected("item-2")).toBe(true);
  });

  it("turn deselect: toggling again deselects turn and items", () => {
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["item-1", "item-2"]);
    useChatNavStore.getState().toggleTurnSelect("turn-1", ["item-1", "item-2"]);
    const s = useChatNavStore.getState();
    expect(s.isTurnSelected("turn-1")).toBe(false);
    expect(s.isItemSelected("item-1")).toBe(false);
    expect(s.isItemSelected("item-2")).toBe(false);
  });

  it("isItemSelected returns correct boolean", () => {
    expect(useChatNavStore.getState().isItemSelected("x")).toBe(false);
    useChatNavStore.getState().toggleItemSelect("x");
    expect(useChatNavStore.getState().isItemSelected("x")).toBe(true);
  });

  it("isTurnSelected returns correct boolean", () => {
    expect(useChatNavStore.getState().isTurnSelected("t-1")).toBe(false);
    useChatNavStore.getState().toggleTurnSelect("t-1", ["i1"]);
    expect(useChatNavStore.getState().isTurnSelected("t-1")).toBe(true);
  });

  it("getSelectedCount returns correct count", () => {
    expect(useChatNavStore.getState().getSelectedCount()).toBe(0);
    useChatNavStore.getState().toggleItemSelect("a");
    useChatNavStore.getState().toggleItemSelect("b");
    expect(useChatNavStore.getState().getSelectedCount()).toBe(2);
  });

  it("hasSelection returns correct boolean", () => {
    expect(useChatNavStore.getState().hasSelection()).toBe(false);
    useChatNavStore.getState().toggleItemSelect("a");
    expect(useChatNavStore.getState().hasSelection()).toBe(true);
  });

  it("clearSelection: resets items, turns, batchMode, pendingAction", () => {
    const s = useChatNavStore.getState();
    s.toggleItemSelect("a");
    s.toggleTurnSelect("t-1", ["i1"]);
    s.setPendingAction({ type: "delete" } as BatchAction);
    s.clearSelection();

    const after = useChatNavStore.getState();
    expect(after.hasSelection()).toBe(false);
    expect(after.getSelectedCount()).toBe(0);
    expect(after.batchModeBySession["test-session"]).toBe(false);
    expect(after.pendingActionBySession["test-session"]).toBeNull();
  });

  it("setBatchMode manually sets mode", () => {
    useChatNavStore.getState().setBatchMode(true);
    expect(useChatNavStore.getState().batchModeBySession["test-session"]).toBe(true);
    useChatNavStore.getState().setBatchMode(false);
    expect(useChatNavStore.getState().batchModeBySession["test-session"]).toBe(false);
  });

  it("setPendingAction: stores action", () => {
    const action: BatchAction = { type: "delete" };
    useChatNavStore.getState().setPendingAction(action);
    expect(useChatNavStore.getState().pendingActionBySession["test-session"]).toEqual({
      type: "delete",
    });
  });

  it("rollback overlay: open then close", () => {
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

  it("collapse all / expand all", () => {
    useChatNavStore.getState().collapseAll();
    expect(useChatNavStore.getState().isTurnCollapsed("any-turn")).toBe(true);
    expect(useChatNavStore.getState().isTurnCollapsed("other-turn")).toBe(true);

    useChatNavStore.getState().expandAll();
    expect(useChatNavStore.getState().isTurnCollapsed("any-turn")).toBe(false);
    expect(useChatNavStore.getState().isTurnCollapsed("other-turn")).toBe(false);
  });

  it("clearSessionUI clears all session-specific state", () => {
    const s = useChatNavStore.getState();
    s.setActive("msg-1");
    s.toggleItemSelect("a");
    s.toggleTurnSelect("t-1", ["i1"]);
    s.setBatchMode(true);
    s.setPendingAction({ type: "delete" } as BatchAction);
    s.collapseAll();

    useChatNavStore.getState().clearSessionUI("test-session");

    const after = useChatNavStore.getState();
    expect(after.activeIdBySession["test-session"]).toBeUndefined();
    expect(after.selectedItemsBySession["test-session"]).toBeUndefined();
    expect(after.selectedTurnsBySession["test-session"]).toBeUndefined();
    expect(after.batchModeBySession["test-session"]).toBeUndefined();
    expect(after.collapsedTurnsBySession["test-session"]).toBeUndefined();
    expect(after.pendingActionBySession["test-session"]).toBeUndefined();
  });

  it("no session (null): all actions are no-ops", () => {
    _activeSessionId = null;
    const s = useChatNavStore.getState();
    s.toggleItemSelect("a");
    s.selectItemRange("a", "b");
    s.toggleTurnSelect("t-1", ["i1"]);
    s.clearSelection();
    s.setBatchMode(true);
    s.setPendingAction({ type: "delete" } as BatchAction);
    s.toggleTurnCollapse("t-1");
    s.collapseAll();
    s.setActive("msg-1");

    const after = useChatNavStore.getState();
    expect(after.selectedItemsBySession).toEqual({});
    expect(after.selectedTurnsBySession).toEqual({});
    expect(after.batchModeBySession).toEqual({});
    expect(after.pendingActionBySession).toEqual({});
    expect(after.collapsedTurnsBySession).toEqual({});
    expect(after.activeIdBySession).toEqual({});
    expect(s.isItemSelected("a")).toBe(false);
    expect(s.isTurnSelected("t-1")).toBe(false);
    expect(s.getSelectedCount()).toBe(0);
    expect(s.hasSelection()).toBe(false);
    expect(s.isTurnCollapsed("t-1")).toBe(false);
  });
});
