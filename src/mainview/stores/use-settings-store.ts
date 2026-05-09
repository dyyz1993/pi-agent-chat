import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DisplaySettings {
  showToolCalls: boolean;
  showToolResults: boolean;
  showThinking: boolean;
  collapseThinking: boolean;
  showTimeline: boolean;
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
  reset: () => void;
}

interface RetryActions {
  setRetryConfig: (config: Partial<RetryConfig>) => void;
  resetRetryConfig: () => void;
}

const DEFAULTS: DisplaySettings = {
  showToolCalls: true,
  showToolResults: true,
  showThinking: true,
  collapseThinking: true,
  showTimeline: true,
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
