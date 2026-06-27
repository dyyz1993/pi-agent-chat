import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatViewMode = "developer" | "clean";
export type FontPreset = "system" | "rounded" | "compact";

export interface DisplaySettings {
  chatViewMode: ChatViewMode;
  fontPreset: FontPreset;
  showToolCalls: boolean;
  showToolResults: boolean;
  showThinking: boolean;
  collapseThinking: boolean;
  collapseToolCards: boolean;
  showTimeline: boolean;
  showMemoryEntries: boolean;
}

export type ToggleSettingKey = {
  [K in keyof DisplaySettings]: DisplaySettings[K] extends boolean ? K : never;
}[keyof DisplaySettings];

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

interface SettingsActions {
  toggle: (key: ToggleSettingKey) => void;
  setAll: (settings: Partial<DisplaySettings>) => void;
  setViewMode: (mode: ChatViewMode) => void;
  setFontPreset: (preset: FontPreset) => void;
  reset: () => void;
}

interface RetryActions {
  setRetryConfig: (config: Partial<RetryConfig>) => void;
  resetRetryConfig: () => void;
}

const DEFAULTS: DisplaySettings = {
  chatViewMode: "developer",
  fontPreset: "system",
  showToolCalls: true,
  showToolResults: true,
  showThinking: false,
  collapseThinking: true,
  collapseToolCards: false,
  showTimeline: true,
  showMemoryEntries: false,
};

const MONO_STACK = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const FONT_STACKS: Record<FontPreset, { sans: string; mono: string }> = {
  system: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    mono: MONO_STACK,
  },
  rounded: {
    sans: '"SF Pro Rounded", ui-rounded, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    mono: MONO_STACK,
  },
  compact: {
    sans: '"Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Segoe UI", ui-sans-serif, system-ui, sans-serif',
    mono: MONO_STACK,
  },
};

export const FONT_PRESET_OPTIONS: { key: FontPreset; labelKey: string; descKey: string }[] = [
  { key: "system", labelKey: "fontPresetSystem", descKey: "fontPresetSystemDesc" },
  { key: "rounded", labelKey: "fontPresetRounded", descKey: "fontPresetRoundedDesc" },
  { key: "compact", labelKey: "fontPresetCompact", descKey: "fontPresetCompactDesc" },
];

function normalizeFontPreset(value: unknown): FontPreset {
  return value === "rounded" || value === "compact" || value === "system" ? value : "system";
}

export function applyFontPreset(preset: FontPreset) {
  if (typeof document === "undefined") return;
  const normalized = normalizeFontPreset(preset);
  const stack = FONT_STACKS[normalized];
  const root = document.documentElement;
  root.dataset.fontPreset = normalized;
  root.style.setProperty("--font-sans", stack.sans);
  root.style.setProperty("--font-mono", stack.mono);
}

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
      setAll: (settings) => {
        const fontPreset =
          settings.fontPreset !== undefined ? normalizeFontPreset(settings.fontPreset) : undefined;
        if (fontPreset) applyFontPreset(fontPreset);
        set({ ...settings, ...(fontPreset ? { fontPreset } : {}) });
      },
      setViewMode: (mode) =>
        set((s) => {
          if (mode === s.chatViewMode) return s;
          if (mode === "clean") {
            return { chatViewMode: "clean", ...CLEAN_OVERRIDES };
          }
          return { chatViewMode: "developer" };
        }),
      setFontPreset: (preset) => {
        const fontPreset = normalizeFontPreset(preset);
        applyFontPreset(fontPreset);
        set({ fontPreset });
      },
      reset: () => {
        applyFontPreset(DEFAULTS.fontPreset);
        set(DEFAULTS);
      },
    }),
    {
      name: "pi-display-settings",
      version: 1,
      migrate: (persistedState, version) => {
        if (version >= 1 || !persistedState || typeof persistedState !== "object") {
          return persistedState;
        }
        return {
          ...(persistedState as Partial<DisplaySettings>),
          showThinking: false,
        };
      },
      onRehydrateStorage: () => (state) => {
        const fontPreset = normalizeFontPreset(state?.fontPreset);
        if (state) state.fontPreset = fontPreset;
        applyFontPreset(fontPreset);
      },
    },
  ),
);

applyFontPreset(normalizeFontPreset(useSettingsStore.getState().fontPreset));

export const useRetryConfigStore = create<RetryConfig & RetryActions>()((set) => ({
  ...RETRY_DEFAULTS,
  setRetryConfig: (config) => set(config),
  resetRetryConfig: () => set(RETRY_DEFAULTS),
}));
