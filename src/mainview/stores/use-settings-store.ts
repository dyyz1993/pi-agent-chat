import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DisplaySettings {
  showToolCalls: boolean;
  showToolResults: boolean;
  showThinking: boolean;
  collapseThinking: boolean;
  showTimeline: boolean;
}

interface SettingsActions {
  toggle: (key: keyof DisplaySettings) => void;
  setAll: (settings: Partial<DisplaySettings>) => void;
  reset: () => void;
}

const DEFAULTS: DisplaySettings = {
  showToolCalls: true,
  showToolResults: true,
  showThinking: true,
  collapseThinking: true,
  showTimeline: true,
};

export const useSettingsStore = create<DisplaySettings & SettingsActions>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      toggle: (key) => set((s) => ({ [key]: !s[key] })),
      setAll: (settings) => set(settings),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "pi-display-settings",
    },
  ),
);
