import { describe, it, expect, beforeEach, vi } from "vitest";

let _activeSessionId: string | null = "test-session";

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: () => ({ activeSessionId: _activeSessionId }),
    subscribe: vi.fn(),
  },
}));

import { useTurnStore } from "../src/mainview/stores/use-turn-store";

function getSelected(): Set<string> {
  return useTurnStore.getState().selectedMessageIdsBySession["test-session"] ?? new Set();
}

function getCollapsed(): Set<string> {
  return useTurnStore.getState().collapsedMessageIdsBySession["test-session"] ?? new Set();
}

beforeEach(() => {
  _activeSessionId = "test-session";
  useTurnStore.setState({
    selectedMessageIdsBySession: {},
    collapsedMessageIdsBySession: {},
    isMultiSelectModeBySession: {},
    selectedNavIdBySession: {},
    navAnchorBySession: {},
  });
});

describe("useTurnStore interaction flows", () => {
  it("single toggle: on then off", () => {
    const { toggleMessageSelection } = useTurnStore.getState();
    toggleMessageSelection("A");
    expect(getSelected().has("A")).toBe(true);

    toggleMessageSelection("A");
    expect(getSelected().has("A")).toBe(false);
    expect(getSelected().size).toBe(0);
  });

  it("multi toggle: A and B both selected", () => {
    const { toggleMessageSelection } = useTurnStore.getState();
    toggleMessageSelection("A");
    toggleMessageSelection("B");
    expect(getSelected().has("A")).toBe(true);
    expect(getSelected().has("B")).toBe(true);
    expect(getSelected().size).toBe(2);
  });

  it("toggle off one keeps the other", () => {
    const { toggleMessageSelection } = useTurnStore.getState();
    toggleMessageSelection("A");
    toggleMessageSelection("B");
    toggleMessageSelection("A");
    expect(getSelected().has("A")).toBe(false);
    expect(getSelected().has("B")).toBe(true);
    expect(getSelected().size).toBe(1);
  });

  it("range select: selects all indices in range", () => {
    const ids = ["a", "b", "c"];
    useTurnStore.getState().selectMessageRange(0, 2, ids);
    const sel = getSelected();
    expect([...sel].sort()).toEqual(["a", "b", "c"]);
  });

  it("range select reversed: works with from > to", () => {
    const ids = ["a", "b", "c"];
    useTurnStore.getState().selectMessageRange(2, 0, ids);
    const sel = getSelected();
    expect([...sel].sort()).toEqual(["a", "b", "c"]);
  });

  it("select all: selects all given ids", () => {
    useTurnStore.getState().selectAll(["a", "b", "c", "d"]);
    const sel = getSelected();
    expect([...sel].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("clear selection: empties selection and turns off multiSelect", () => {
    const s = useTurnStore.getState();
    s.toggleMessageSelection("A");
    s.toggleMessageSelection("B");
    s.clearSelection();

    expect(useTurnStore.getState().selectedMessageIdsBySession["test-session"]).toBeUndefined();
    expect(useTurnStore.getState().isMultiSelectModeBySession["test-session"]).toBe(false);
  });

  it("toggle multiSelect mode: on then off clears selection", () => {
    const s = useTurnStore.getState();
    s.toggleMultiSelectMode();
    expect(useTurnStore.getState().isMultiSelectModeBySession["test-session"]).toBe(true);

    s.toggleMessageSelection("A");

    s.toggleMultiSelectMode();
    expect(useTurnStore.getState().isMultiSelectModeBySession["test-session"]).toBe(false);
    expect(useTurnStore.getState().selectedMessageIdsBySession["test-session"]).toBeUndefined();
  });

  it("clearSessionUI: clears all session UI state", () => {
    const s = useTurnStore.getState();
    s.toggleMessageSelection("A");
    s.toggleCollapse("C");
    s.toggleMultiSelectMode();
    s.setNavId("nav-1", "top");

    s.clearSessionUI("test-session");

    const state = useTurnStore.getState();
    expect(state.selectedMessageIdsBySession["test-session"]).toBeUndefined();
    expect(state.collapsedMessageIdsBySession["test-session"]).toBeUndefined();
    expect(state.isMultiSelectModeBySession["test-session"]).toBeUndefined();
    expect(state.selectedNavIdBySession["test-session"]).toBeUndefined();
    expect(state.navAnchorBySession["test-session"]).toBeUndefined();
  });

  it("no session: all actions are no-ops", () => {
    _activeSessionId = null;
    const s = useTurnStore.getState();
    s.toggleMessageSelection("A");
    s.selectAll(["a", "b"]);
    s.selectMessageRange(0, 1, ["x", "y"]);
    s.clearSelection();
    s.toggleMultiSelectMode();
    s.toggleCollapse("C");
    s.setNavId("nav-1", "top");

    const state = useTurnStore.getState();
    expect(state.selectedMessageIdsBySession).toEqual({});
    expect(state.collapsedMessageIdsBySession).toEqual({});
    expect(state.isMultiSelectModeBySession).toEqual({});
    expect(state.selectedNavIdBySession).toEqual({});
    expect(state.navAnchorBySession).toEqual({});
  });

  it("toggle collapse: on then off", () => {
    useTurnStore.getState().toggleCollapse("msg-1");
    expect(getCollapsed().has("msg-1")).toBe(true);

    useTurnStore.getState().toggleCollapse("msg-1");
    expect(getCollapsed().has("msg-1")).toBe(false);
  });

  it("set nav: sets both navId and anchor", () => {
    useTurnStore.getState().setNavId("msg-1", "top");
    const state = useTurnStore.getState();
    expect(state.selectedNavIdBySession["test-session"]).toBe("msg-1");
    expect(state.navAnchorBySession["test-session"]).toBe("top");
  });
});
