import { describe, it, expect, beforeEach } from "vitest";

import {
  useSidebarStore,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "../src/mainview/stores/use-sidebar-store";

describe("useSidebarStore", () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* happy-dom may not support clear */
    }
    useSidebarStore.setState({
      activePanel: "explorer",
      isPinned: false,
      drawerOpen: false,
      sidebarWidth: 240,
      breakpoint: "desktop",
    });
  });

  it("initial activePanel is explorer", () => {
    expect(useSidebarStore.getState().activePanel).toBe("explorer");
  });

  it("togglePanel to new panel sets activePanel and opens drawer when not pinned", () => {
    useSidebarStore.getState().togglePanel("git");
    const s = useSidebarStore.getState();
    expect(s.activePanel).toBe("git");
    expect(s.drawerOpen).toBe(true);
  });

  it("togglePanel same panel deactivates", () => {
    useSidebarStore.getState().togglePanel("explorer");
    const s = useSidebarStore.getState();
    expect(s.activePanel).toBeNull();
    expect(s.drawerOpen).toBe(false);
  });

  it("setPinned(true) sets isPinned and closes drawer", () => {
    useSidebarStore.getState().setPinned(true);
    const s = useSidebarStore.getState();
    expect(s.isPinned).toBe(true);
    expect(s.drawerOpen).toBe(false);
  });

  it("setDrawerOpen(false) when not pinned closes drawer and clears activePanel", () => {
    useSidebarStore.setState({ activePanel: "git", drawerOpen: true, isPinned: false });
    useSidebarStore.getState().setDrawerOpen(false);
    const s = useSidebarStore.getState();
    expect(s.drawerOpen).toBe(false);
    expect(s.activePanel).toBeNull();
  });

  it("setDrawerOpen(false) when pinned only closes drawer", () => {
    useSidebarStore.setState({ activePanel: "git", drawerOpen: true, isPinned: true });
    useSidebarStore.getState().setDrawerOpen(false);
    const s = useSidebarStore.getState();
    expect(s.drawerOpen).toBe(false);
    expect(s.activePanel).toBe("git");
  });

  it("setSidebarWidth sets width within bounds", () => {
    useSidebarStore.getState().setSidebarWidth(300);
    expect(useSidebarStore.getState().sidebarWidth).toBe(300);
  });

  it(`setSidebarWidth clamps to MIN (${SIDEBAR_MIN_WIDTH})`, () => {
    useSidebarStore.getState().setSidebarWidth(100);
    expect(useSidebarStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  it(`setSidebarWidth clamps to MAX (${SIDEBAR_MAX_WIDTH})`, () => {
    useSidebarStore.getState().setSidebarWidth(600);
    expect(useSidebarStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("_setBreakpoint sets breakpoint", () => {
    useSidebarStore.getState()._setBreakpoint("mobile");
    expect(useSidebarStore.getState().breakpoint).toBe("mobile");
  });
});
