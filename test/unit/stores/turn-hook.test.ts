import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: () => {},
  useSessionStore: {
    getState: () => ({ activeSessionId: "test-session" }),
    subscribe: vi.fn(),
  },
}));

import { useTurnStore } from "../../../src/mainview/stores/use-turn-store";

describe("useTurnStore", () => {
  beforeEach(() => {
    useTurnStore.setState({
      selectedMessageIdsBySession: {},
      collapsedMessageIdsBySession: {},
      isMultiSelectModeBySession: {},
      selectedNavIdBySession: {},
      navAnchorBySession: {},
    });
  });

  it("initial state is all empty", () => {
    const s = useTurnStore.getState();
    expect(s.selectedMessageIdsBySession).toEqual({});
    expect(s.collapsedMessageIdsBySession).toEqual({});
    expect(s.isMultiSelectModeBySession).toEqual({});
    expect(s.selectedNavIdBySession).toEqual({});
    expect(s.navAnchorBySession).toEqual({});
  });

  it("toggleMessageSelection selects a message", () => {
    useTurnStore.getState().toggleMessageSelection("msg-1");
    const selected = useTurnStore.getState().selectedMessageIdsBySession["test-session"];
    expect(selected).toBeInstanceOf(Set);
    expect(selected?.has("msg-1")).toBe(true);
  });

  it("toggleMessageSelection toggles off on second click", () => {
    useTurnStore.getState().toggleMessageSelection("msg-1");
    useTurnStore.getState().toggleMessageSelection("msg-1");
    const selected = useTurnStore.getState().selectedMessageIdsBySession["test-session"];
    expect(selected?.has("msg-1")).toBe(false);
  });

  it("selectMessageRange selects messages in range", () => {
    const ids = ["a", "b", "c", "d", "e"];
    useTurnStore.getState().selectMessageRange(0, 2, ids);
    const selected = useTurnStore.getState().selectedMessageIdsBySession["test-session"];
    expect([...selected!].sort()).toEqual(["a", "b", "c"]);
  });

  it("clearSelection clears selected messages and resets multi-select", () => {
    useTurnStore.getState().toggleMessageSelection("msg-1");
    useTurnStore.getState().clearSelection();
    expect(useTurnStore.getState().selectedMessageIdsBySession["test-session"]).toBeUndefined();
    expect(useTurnStore.getState().isMultiSelectModeBySession["test-session"]).toBe(false);
  });

  it("selectAll selects all given message ids", () => {
    const ids = ["a", "b", "c"];
    useTurnStore.getState().selectAll(ids);
    const selected = useTurnStore.getState().selectedMessageIdsBySession["test-session"];
    expect([...selected!].sort()).toEqual(["a", "b", "c"]);
  });

  it("toggleMultiSelectMode toggles on and off", () => {
    useTurnStore.getState().toggleMultiSelectMode();
    expect(useTurnStore.getState().isMultiSelectModeBySession["test-session"]).toBe(true);

    useTurnStore.getState().toggleMultiSelectMode();
    expect(useTurnStore.getState().isMultiSelectModeBySession["test-session"]).toBe(false);
  });

  it("toggleCollapse toggles message collapse state", () => {
    useTurnStore.getState().toggleCollapse("msg-1");
    const collapsed = useTurnStore.getState().collapsedMessageIdsBySession["test-session"];
    expect(collapsed?.has("msg-1")).toBe(true);

    useTurnStore.getState().toggleCollapse("msg-1");
    const after = useTurnStore.getState().collapsedMessageIdsBySession["test-session"];
    expect(after?.has("msg-1")).toBe(false);
  });

  it("setNavId sets nav id and anchor", () => {
    useTurnStore.getState().setNavId("nav-1", "top");
    const s = useTurnStore.getState();
    expect(s.selectedNavIdBySession["test-session"]).toBe("nav-1");
    expect(s.navAnchorBySession["test-session"]).toBe("top");

    useTurnStore.getState().setNavId("nav-2");
    expect(useTurnStore.getState().selectedNavIdBySession["test-session"]).toBe("nav-2");
    expect(useTurnStore.getState().navAnchorBySession["test-session"]).toBe("top");
  });

  it("clearSessionUI removes all data for a session", () => {
    useTurnStore.getState().toggleMessageSelection("msg-1");
    useTurnStore.getState().toggleCollapse("msg-1");
    useTurnStore.getState().toggleMultiSelectMode();
    useTurnStore.getState().setNavId("nav-1", "bottom");

    useTurnStore.getState().clearSessionUI("test-session");

    const s = useTurnStore.getState();
    expect(s.selectedMessageIdsBySession["test-session"]).toBeUndefined();
    expect(s.collapsedMessageIdsBySession["test-session"]).toBeUndefined();
    expect(s.isMultiSelectModeBySession["test-session"]).toBeUndefined();
    expect(s.selectedNavIdBySession["test-session"]).toBeUndefined();
    expect(s.navAnchorBySession["test-session"]).toBeUndefined();
  });
});
