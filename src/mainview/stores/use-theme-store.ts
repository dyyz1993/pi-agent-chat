import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "../lib/i18n";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("settings");

export type Theme = "light" | "dark";
export type ResolvedTheme = Theme;

export const THEME_META: Record<Theme, { label: string; group: "light" | "dark" }> = {
  light: { label: "Light", group: "light" },
  dark: { label: "Dark", group: "dark" },
};

export function isDarkGroup(resolved: ResolvedTheme): boolean {
  return THEME_META[resolved]?.group === "dark";
}

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  language: string;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: string) => void;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeTheme(value: unknown): Theme {
  if (value === "light" || value === "dark") return value;

  // Migrate removed themes into the two-theme system without leaving stale data-theme values.
  if (value === "solarized" || value === "latte") return "light";
  if (value === "system") return getSystemTheme();
  return "dark";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return normalizeTheme(theme);
}

function applyTheme(resolved: ResolvedTheme) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  html.setAttribute("data-theme", resolved);
  const group = THEME_META[resolved]?.group ?? "dark";
  html.classList.add(group);
  if (group === "dark") {
    html.classList.add("dark");
  }
  html.style.colorScheme = group;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark" as Theme,
      resolvedTheme: "dark" as ResolvedTheme,
      language: i18n.language || "zh-CN",
      setTheme: (theme: Theme) => {
        const resolved = resolveTheme(theme);
        applyTheme(resolved);
        set({ theme, resolvedTheme: resolved });
      },
      setLanguage: (lang: string) => {
        try {
          void i18n.changeLanguage(lang);
        } catch (e) {
          log.warn("Failed to change language", { lang, error: String(e) });
        }
        set({ language: lang });
      },
    }),
    {
      name: "pi-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const theme = normalizeTheme(state.theme);
          const resolved = resolveTheme(theme);
          applyTheme(resolved);
          state.theme = theme;
          state.resolvedTheme = resolved;
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  const theme = normalizeTheme(useThemeStore.getState().theme);
  const resolved = resolveTheme(theme);
  useThemeStore.setState({ theme, resolvedTheme: resolved });
  applyTheme(resolved);
}
