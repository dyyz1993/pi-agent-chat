import { create } from "zustand";
import type { Breakpoint, PanelVisibility, PanelTabId } from "./types";

const SESSION_WIDTH_KEY = "layout-session-width";
const STATUS_WIDTH_KEY = "layout-status-width";

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
  try { localStorage.setItem(key, String(v)); } catch {}
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

  sessionPanel: "pinned",
  statusPanel: "pinned",

  sessionWidth: readNum(SESSION_WIDTH_KEY, 240),
  statusWidth: readNum(STATUS_WIDTH_KEY, 300),
  activePanelTab: "status",

  setBreakpoint: (bp) => set({ breakpoint: bp }),

  toggleSession: () => {
    const cur = get().sessionPanel;
    const next: PanelVisibility = cur === "pinned" ? "visible" : "pinned";
    set({ sessionPanel: next });
  },
  pinSession: () => set({ sessionPanel: "pinned" }),
  unpinSession: () => set({ sessionPanel: "visible" }),
  showSession: () => set({ sessionPanel: "visible" }),
  hideSession: () => set({ sessionPanel: "hidden" }),
  setSessionWidth: (w) => {
    const clamped = Math.max(180, Math.min(420, w));
    set({ sessionWidth: clamped });
    writeNum(SESSION_WIDTH_KEY, clamped);
  },

  toggleStatus: () => {
    const cur = get().statusPanel;
    const next: PanelVisibility = cur === "pinned" ? "visible" : "pinned";
    set({ statusPanel: next });
  },
  pinStatus: () => set({ statusPanel: "pinned" }),
  unpinStatus: () => set({ statusPanel: "visible" }),
  showStatus: () => set({ statusPanel: "visible" }),
  hideStatus: () => set({ statusPanel: "hidden" }),
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
