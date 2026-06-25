import { Moon, Sun } from "lucide-react";
import { useThemeStore, THEME_META, type Theme } from "../../stores/use-theme-store";
import { IconButton } from "../primitives";

const THEME_SEQUENCE: Theme[] = ["light", "dark"];

function getThemeLabel(theme: Theme): string {
  return THEME_META[theme].label;
}

function getThemeIcon(theme: Theme) {
  return THEME_META[theme].group === "light" ? Sun : Moon;
}

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const Icon = getThemeIcon(theme);

  return (
    <IconButton
      data-testid="theme-toggle"
      label={`theme ${getThemeLabel(theme)}`}
      onClick={() => {
        const currentIndex = THEME_SEQUENCE.indexOf(theme);
        const next = THEME_SEQUENCE[(currentIndex + 1) % THEME_SEQUENCE.length];
        setTheme(next);
      }}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  );
}
