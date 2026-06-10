import { create } from "zustand";
import type { Breakpoint, PanelVisibility, PanelTabId } from "./types";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("settings");

const V = "v1";
const SESSION_WIDTH_KEY = `layout-session-width-${V}`;
const STATUS_WIDTH_KEY = `layout-status-width-${V}`;
const SESSION_PANEL_KEY = `layout-session-panel-${V}`;
const STATUS_PANEL_KEY = `layout-status-panel-${V}`;
const SESSION_COLLAPSED_KEY = `layout-session-collapsed-${V}`;

const SESSION_MIN = 180;
const SESSION_MAX = 420;
const STATUS_MIN = 220;

function getStatusMax() {
  if (typeof window === "undefined") return 1200;
  return Math.min(1200, Math.floor(window.innerWidth * 0.7));
}

function clampSession(w: number) {
  return Math.max(SESSION_MIN, Math.min(SESSION_MAX, Math.floor(w)));
}

function clampStatus(w: number) {
  return Math.max(STATUS_MIN, Math.min(getStatusMax(), Math.floor(w)));
}

function getBreakpoint(w: number): Breakpoint {
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  if (w < 1440) return "desktop";
  return "wide";
}

function readNum(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    const n = Number(v);
    return Number.isNaN(n) ? fallback : n;
  } catch (e) {
    log.warn("Failed to read layout number from localStorage", { key, error: String(e) });
    return fallback;
  }
}

function writeNum(key: string, v: number) {
  try {
    localStorage.setItem(key, String(v));
  } catch (e) {
    log.warn("Failed to write layout number to localStorage", { key, error: String(e) });
  }
}

function writePanel(key: string, v: PanelVisibility) {
  try {
    localStorage.setItem(key, v);
  } catch (e) {
    log.warn("Failed to write panel state to localStorage", { key, error: String(e) });
  }
}

function readPanel(key: string, fallback: PanelVisibility): PanelVisibility {
  try {
    const v = localStorage.getItem(key);
    if (v === null || (v !== "pinned" && v !== "visible" && v !== "hidden")) return fallback;
    return v as PanelVisibility;
  } catch (e) {
    log.warn("Failed to read panel state from localStorage", { key, error: String(e) });
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "true";
  } catch (e) {
    log.warn("Failed to read layout boolean from localStorage", { key, error: String(e) });
    return fallback;
  }
}

function writeBool(key: string, v: boolean) {
  try {
    localStorage.setItem(key, String(v));
  } catch (e) {
    log.warn("Failed to write layout boolean to localStorage", { key, error: String(e) });
  }
}

export interface LayoutState {
  breakpoint: Breakpoint;
  contentWidth: number;
  sessionPanel: PanelVisibility;
  statusPanel: PanelVisibility;
  sessionWidth: number;
  statusWidth: number;
  activePanelTab: PanelTabId;
  sessionCollapsed: boolean;

  setBreakpoint: (bp: Breakpoint) => void;
  setContentWidth: (w: number) => void;

  toggleSession: () => void;
  pinSession: () => void;
  unpinSession: () => void;
  showSession: () => void;
  hideSession: () => void;
  setSessionWidth: (w: number) => void;
  toggleSessionCollapse: () => void;

  toggleStatus: () => void;
  pinStatus: () => void;
  unpinStatus: () => void;
  showStatus: () => void;
  hideStatus: () => void;
  setStatusWidth: (w: number) => void;
  openStatusPanel: (tab?: PanelTabId) => void;

  setActivePanelTab: (tab: PanelTabId) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  breakpoint: getBreakpoint(typeof window !== "undefined" ? window.innerWidth : 1440),
  contentWidth: typeof window !== "undefined" ? window.innerWidth : 1440,

  sessionPanel: readPanel(SESSION_PANEL_KEY, "pinned"),
  statusPanel: readPanel(STATUS_PANEL_KEY, "pinned"),

  sessionWidth: clampSession(readNum(SESSION_WIDTH_KEY, 200)),
  statusWidth: clampStatus(readNum(STATUS_WIDTH_KEY, 300)),
  activePanelTab: "changeReview",
  sessionCollapsed: readBool(SESSION_COLLAPSED_KEY, false),

  setContentWidth: (w) => set({ contentWidth: w }),

  setBreakpoint: (bp) => {
    const prev = get().breakpoint;
    const reclamp = bp !== prev;
    set({ breakpoint: bp });

    if (bp === "mobile" && prev !== "mobile") {
      const sp = get().sessionPanel;
      const st = get().statusPanel;
      if (sp === "pinned") {
        set({ sessionPanel: "hidden" });
        writePanel(SESSION_PANEL_KEY, "hidden");
      }
      if (st === "pinned") {
        set({ statusPanel: "hidden" });
        writePanel(STATUS_PANEL_KEY, "hidden");
      }
    }
    if (bp !== "mobile" && prev === "mobile") {
      const sp = get().sessionPanel;
      const st = get().statusPanel;
      if (sp === "hidden") {
        set({ sessionPanel: "pinned" });
        writePanel(SESSION_PANEL_KEY, "pinned");
      }
      if (st === "hidden") {
        set({ statusPanel: "pinned" });
        writePanel(STATUS_PANEL_KEY, "pinned");
      }
    }

    if (reclamp) {
      const sw = clampSession(get().sessionWidth);
      const stw = clampStatus(get().statusWidth);
      set({ sessionWidth: sw, statusWidth: stw });
      writeNum(SESSION_WIDTH_KEY, sw);
      writeNum(STATUS_WIDTH_KEY, stw);
    }
  },

  toggleSession: () => {
    const cur = get().sessionPanel;
    const next: PanelVisibility = cur === "pinned" ? "visible" : "pinned";
    set({ sessionPanel: next });
    writePanel(SESSION_PANEL_KEY, next);
  },
  pinSession: () => {
    set({ sessionPanel: "pinned" });
    writePanel(SESSION_PANEL_KEY, "pinned");
  },
  unpinSession: () => {
    set({ sessionPanel: "visible" });
    writePanel(SESSION_PANEL_KEY, "visible");
  },
  showSession: () => {
    set({ sessionPanel: "visible" });
    writePanel(SESSION_PANEL_KEY, "visible");
  },
  hideSession: () => {
    set({ sessionPanel: "hidden" });
    writePanel(SESSION_PANEL_KEY, "hidden");
  },
  setSessionWidth: (w) => {
    const clamped = clampSession(w);
    set({ sessionWidth: clamped });
    writeNum(SESSION_WIDTH_KEY, clamped);
  },
  toggleSessionCollapse: () => {
    const next = !get().sessionCollapsed;
    set({ sessionCollapsed: next });
    writeBool(SESSION_COLLAPSED_KEY, next);
  },

  toggleStatus: () => {
    const cur = get().statusPanel;
    const next: PanelVisibility = cur === "pinned" ? "visible" : "pinned";
    set({ statusPanel: next });
    writePanel(STATUS_PANEL_KEY, next);
  },
  pinStatus: () => {
    set({ statusPanel: "pinned" });
    writePanel(STATUS_PANEL_KEY, "pinned");
  },
  unpinStatus: () => {
    set({ statusPanel: "visible" });
    writePanel(STATUS_PANEL_KEY, "visible");
  },
  showStatus: () => {
    set({ statusPanel: "visible" });
    writePanel(STATUS_PANEL_KEY, "visible");
  },
  hideStatus: () => {
    set({ statusPanel: "hidden" });
    writePanel(STATUS_PANEL_KEY, "hidden");
  },
  setStatusWidth: (w) => {
    const clamped = clampStatus(w);
    set({ statusWidth: clamped });
    writeNum(STATUS_WIDTH_KEY, clamped);
  },
  openStatusPanel: (tab) => {
    const patch: Partial<LayoutState> = { statusPanel: "visible" };
    if (tab) patch.activePanelTab = tab;
    set(patch);
    writePanel(STATUS_PANEL_KEY, "visible");
  },

  setActivePanelTab: (tab) => set({ activePanelTab: tab }),

  isSessionVisible: () => {
    const bp = get().breakpoint;
    if (bp === "mobile") return false;
    return get().sessionPanel !== "hidden";
  },

  isStatusVisible: () => {
    const bp = get().breakpoint;
    if (bp === "mobile" || bp === "tablet") return false;
    return get().statusPanel !== "hidden";
  },
}));
