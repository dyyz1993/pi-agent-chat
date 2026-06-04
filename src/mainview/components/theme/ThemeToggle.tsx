import { Monitor, Moon, Sun } from "lucide-react";
import { useThemeStore, THEME_META, type Theme } from "../../stores/use-theme-store";

const THEME_SEQUENCE: Theme[] = [
  "light",
  "dark",
  "nord",
  "solarized",
  "warm-dark",
  "rose",
  "latte",
  "sunset",
  "system",
];

function getThemeLabel(theme: Theme): string {
  return theme === "system" ? "system" : THEME_META[theme].label;
}

function getThemeIcon(theme: Theme) {
  if (theme === "system") return Monitor;
  return THEME_META[theme].group === "light" ? Sun : Moon;
}

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const Icon = getThemeIcon(theme);

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      title={`theme ${getThemeLabel(theme)}`}
      aria-label={`theme ${getThemeLabel(theme)}`}
      onClick={() => {
        const currentIndex = THEME_SEQUENCE.indexOf(theme);
        const next = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length];
        setTheme(next);
      }}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
