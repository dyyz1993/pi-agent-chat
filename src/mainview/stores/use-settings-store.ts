import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatViewMode = "developer" | "clean";

export interface DisplaySettings {
  chatViewMode: ChatViewMode;
  showToolCalls: boolean;
  showToolResults: boolean;
  showThinking: boolean;
  collapseThinking: boolean;
  collapseToolCards: boolean;
  showTimeline: boolean;
  showMemoryEntries: boolean;
}

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

interface SettingsActions {
  toggle: (key: keyof DisplaySettings) => void;
  setAll: (settings: Partial<DisplaySettings>) => void;
  setViewMode: (mode: ChatViewMode) => void;
  reset: () => void;
}

interface RetryActions {
  setRetryConfig: (config: Partial<RetryConfig>) => void;
  resetRetryConfig: () => void;
}

const DEFAULTS: DisplaySettings = {
  chatViewMode: "developer",
  showToolCalls: true,
  showToolResults: true,
  showThinking: true,
  collapseThinking: true,
  collapseToolCards: false,
  showTimeline: true,
  showMemoryEntries: false,
};

const CLEAN_OVERRIDES: Partial<DisplaySettings> = {
  showThinking: false,
  collapseToolCards: true,
  showTimeline: false,
};

export const RETRY_DEFAULTS: RetryConfig = {
  enabled: true,
  maxRetries: 20,
  baseDelayMs: 5000,
  maxDelayMs: 600000,
};

export const useSettingsStore = create<DisplaySettings & SettingsActions>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      toggle: (key) => set((s) => ({ [key]: !s[key] })),
      setAll: (settings) => set(settings),
      setViewMode: (mode) =>
        set((s) => {
          if (mode === s.chatViewMode) return s;
          if (mode === "clean") {
            return { chatViewMode: "clean", ...CLEAN_OVERRIDES };
          }
          return { chatViewMode: "developer" };
        }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "pi-display-settings",
    },
  ),
);

export const useRetryConfigStore = create<RetryConfig & RetryActions>()((set) => ({
  ...RETRY_DEFAULTS,
  setRetryConfig: (config) => set(config),
  resetRetryConfig: () => set(RETRY_DEFAULTS),
}));
