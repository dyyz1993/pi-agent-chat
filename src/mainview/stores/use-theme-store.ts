import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "../lib/i18n";

export type Theme =
  | "light"
  | "dark"
  | "nord"
  | "solarized"
  | "warm-dark"
  | "rose"
  | "latte"
  | "sunset"
  | "system";

export const THEME_META: Record<
  Exclude<Theme, "system">,
  { label: string; group: "light" | "dark" }
> = {
  light: { label: "Light", group: "light" },
  dark: { label: "Dark", group: "dark" },
  nord: { label: "Nord", group: "dark" },
  solarized: { label: "Solarized", group: "light" },
  "warm-dark": { label: "Warm Dark", group: "dark" },
  rose: { label: "Rosé Pine", group: "dark" },
  latte: { label: "Latte", group: "light" },
  sunset: { label: "Sunset", group: "dark" },
};

export function isDarkGroup(resolved: Exclude<Theme, "system">): boolean {
  return THEME_META[resolved]?.group === "dark";
}

interface ThemeState {
  theme: Theme;
  resolvedTheme: Exclude<Theme, "system">;
  language: string;
  setTheme: (theme: Theme) => void;
  setLanguage: (lang: string) => void;
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): Exclude<Theme, "system"> {
  if (theme === "system") return getSystemTheme();
  return theme;
}

function applyTheme(resolved: Exclude<Theme, "system">) {
  const html = document.documentElement;
  html.classList.remove("dark", "light");
  html.setAttribute("data-theme", resolved);
  const group = THEME_META[resolved]?.group ?? "dark";
  if (group === "dark") {
    html.classList.add("dark");
  }
  html.style.colorScheme = group;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark" as Theme,
      resolvedTheme: "dark" as Exclude<Theme, "system">,
      language: i18n.language || "zh-CN",
      setTheme: (theme: Theme) => {
        const resolved = resolveTheme(theme);
        applyTheme(resolved);
        set({ theme, resolvedTheme: resolved });
      },
      setLanguage: (lang: string) => {
        try {
          void i18n.changeLanguage(lang);
        } catch {
          // ignore
        }
        set({ language: lang });
      },
    }),
    {
      name: "pi-theme",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved = resolveTheme(state.theme);
          applyTheme(resolved);
          state.resolvedTheme = resolved;
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", () => {
    const state = useThemeStore.getState();
    if (state.theme === "system") {
      const resolved = getSystemTheme() as Exclude<Theme, "system">;
      applyTheme(resolved);
      useThemeStore.setState({ resolvedTheme: resolved });
    }
  });

  const resolved = resolveTheme(useThemeStore.getState().theme);
  applyTheme(resolved);
}
