import { create } from "zustand";
import type { Breakpoint, PanelVisibility, PanelTabId } from "./types";

const SESSION_WIDTH_KEY = "layout-session-width";
const STATUS_WIDTH_KEY = "layout-status-width";
const SESSION_PANEL_KEY = "layout-session-panel";
const STATUS_PANEL_KEY = "layout-status-panel";

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
  } catch {
    return fallback;
  }
}

function writeNum(key: string, v: number) {
  try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
}

function readPanel(key: string, fallback: PanelVisibility): PanelVisibility {
  try {
    const v = localStorage.getItem(key);
    if (v === null || v !== "pinned" && v !== "visible" && v !== "hidden") return fallback;
    return v as PanelVisibility;
  } catch {
    return fallback;
  }
}

function writePanel(key: string, v: PanelVisibility) {
  try { localStorage.setItem(key, v); } catch {}
}

export interface LayoutState {
  breakpoint: Breakpoint;
  sessionPanel: PanelVisibility;
  statusPanel: PanelVisibility;
  sessionWidth: number;
  statusWidth: number;
  activePanelTab: PanelTabId;

  setBreakpoint: (bp: Breakpoint) => void;

  toggleSession: () => void;
  pinSession: () => void;
  unpinSession: () => void;
  showSession: () => void;
  hideSession: () => void;
  setSessionWidth: (w: number) => void;

  toggleStatus: () => void;
  pinStatus: () => void;
  unpinStatus: () => void;
  showStatus: () => void;
  hideStatus: () => void;
  setStatusWidth: (w: number) => void;

  setActivePanelTab: (tab: PanelTabId) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  breakpoint: getBreakpoint(typeof window !== "undefined" ? window.innerWidth : 1440),

  sessionPanel: readPanel(SESSION_PANEL_KEY, "pinned"),
  statusPanel: readPanel(STATUS_PANEL_KEY, "pinned"),

  sessionWidth: readNum(SESSION_WIDTH_KEY, 240),
  statusWidth: readNum(STATUS_WIDTH_KEY, 300),
  activePanelTab: "status",

  setBreakpoint: (bp) => {
    const prev = get().breakpoint;
    set({ breakpoint: bp });
    if (bp === "mobile" && prev !== "mobile") {
      const sp = get().sessionPanel;
      const st = get().statusPanel;
      if (sp === "pinned") { set({ sessionPanel: "hidden" }); writePanel(SESSION_PANEL_KEY, "hidden"); }
      if (st === "pinned") { set({ statusPanel: "hidden" }); writePanel(STATUS_PANEL_KEY, "hidden"); }
    }
    if (bp !== "mobile" && prev === "mobile") {
      const sp = get().sessionPanel;
      const st = get().statusPanel;
      if (sp === "hidden") { set({ sessionPanel: "pinned" }); writePanel(SESSION_PANEL_KEY, "pinned"); }
      if (st === "hidden") { set({ statusPanel: "pinned" }); writePanel(STATUS_PANEL_KEY, "pinned"); }
    }
  },

  toggleSession: () => {
    const cur = get().sessionPanel;
    const next: PanelVisibility = cur === "pinned" ? "visible" : "pinned";
    set({ sessionPanel: next });
    writePanel(SESSION_PANEL_KEY, next);
  },
  pinSession: () => { set({ sessionPanel: "pinned" }); writePanel(SESSION_PANEL_KEY, "pinned"); },
  unpinSession: () => { set({ sessionPanel: "visible" }); writePanel(SESSION_PANEL_KEY, "visible"); },
  showSession: () => { set({ sessionPanel: "visible" }); writePanel(SESSION_PANEL_KEY, "visible"); },
  hideSession: () => { set({ sessionPanel: "hidden" }); writePanel(SESSION_PANEL_KEY, "hidden"); },
  setSessionWidth: (w) => {
    const clamped = Math.max(180, Math.min(420, w));
    set({ sessionWidth: clamped });
    writeNum(SESSION_WIDTH_KEY, clamped);
  },

  toggleStatus: () => {
    const cur = get().statusPanel;
    const next: PanelVisibility = cur === "pinned" ? "visible" : "pinned";
    set({ statusPanel: next });
    writePanel(STATUS_PANEL_KEY, next);
  },
  pinStatus: () => { set({ statusPanel: "pinned" }); writePanel(STATUS_PANEL_KEY, "pinned"); },
  unpinStatus: () => { set({ statusPanel: "visible" }); writePanel(STATUS_PANEL_KEY, "visible"); },
  showStatus: () => { set({ statusPanel: "visible" }); writePanel(STATUS_PANEL_KEY, "visible"); },
  hideStatus: () => { set({ statusPanel: "hidden" }); writePanel(STATUS_PANEL_KEY, "hidden"); },
  setStatusWidth: (w) => {
    const clamped = Math.max(220, Math.min(500, w));
    set({ statusWidth: clamped });
    writeNum(STATUS_WIDTH_KEY, clamped);
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
