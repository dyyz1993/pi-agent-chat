import { create } from "zustand";

export type SidebarPanelId = "explorer" | "git" | "search";
export type Breakpoint = "mobile" | "tablet" | "desktop";

const PINNED_KEY = "sidebar-pinned";
const WIDTH_KEY = "sidebar-width";
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

function getBreakpoint(width: number): Breakpoint {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

interface SidebarState {
  activePanel: SidebarPanelId | null;
  isPinned: boolean;
  drawerOpen: boolean;
  sidebarWidth: number;
  breakpoint: Breakpoint;
  togglePanel: (id: SidebarPanelId) => void;
  setActivePanel: (id: SidebarPanelId | null) => void;
  setPinned: (pinned: boolean) => void;
  setDrawerOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  _setBreakpoint: (bp: Breakpoint) => void;
}

function readPinned(): boolean {
  try {
    const stored = localStorage.getItem(PINNED_KEY);
    if (stored !== null) return stored !== "false";
    // 首次加载：desktop 默认 pinned，tablet/mobile 默认 drawer
    return window.innerWidth >= 1024;
  } catch {
    return true;
  }
}

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isNaN(v) || v < SIDEBAR_MIN_WIDTH || v > SIDEBAR_MAX_WIDTH) return DEFAULT_WIDTH;
    return v;
  } catch {
    return DEFAULT_WIDTH;
  }
}

const initialWidth = typeof window !== "undefined" ? window.innerWidth : 1024;

export const useSidebarStore = create<SidebarState>((set, get) => ({
  activePanel: "explorer",
  isPinned: readPinned(),
  drawerOpen: false,
  sidebarWidth: readWidth(),
  breakpoint: getBreakpoint(initialWidth),

  togglePanel: (id) => {
    const { activePanel, isPinned } = get();
    if (activePanel === id) {
      set({ activePanel: null, drawerOpen: false });
    } else {
      set({ activePanel: id, drawerOpen: !isPinned });
    }
  },

  setActivePanel: (id) => set({ activePanel: id }),

  setPinned: (pinned) => {
    try {
      localStorage.setItem(PINNED_KEY, String(pinned));
    } catch { /* ignore */ }
    set({ isPinned: pinned, drawerOpen: false });
  },

  setDrawerOpen: (open) => {
    if (!open) {
      const { isPinned } = get();
      if (!isPinned) set({ drawerOpen: false, activePanel: null });
      else set({ drawerOpen: false });
    } else {
      set({ drawerOpen: true });
    }
  },

  setSidebarWidth: (width) => {
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
    try {
      localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch { /* ignore */ }
    set({ sidebarWidth: clamped });
  },

  _setBreakpoint: (bp) => set({ breakpoint: bp }),
}));
