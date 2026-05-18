import { Moon, Sun, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useThemeStore, THEME_META } from "../../stores/use-theme-store";
import type { Theme } from "../../stores/use-theme-store";

export function ThemeToggle() {
  const { t } = useTranslation("theme");
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const THEME_OPTIONS: { value: Theme; icon: typeof Moon; label: string }[] = [
    { value: "light", icon: Sun, label: THEME_META.light.label },
    { value: "dark", icon: Moon, label: THEME_META.dark.label },
    { value: "nord", icon: Moon, label: THEME_META.nord.label },
    { value: "solarized", icon: Sun, label: THEME_META.solarized.label },
    { value: "warm-dark", icon: Moon, label: THEME_META["warm-dark"].label },
    { value: "rose", icon: Moon, label: THEME_META.rose.label },
    { value: "latte", icon: Sun, label: THEME_META.latte.label },
    { value: "sunset", icon: Moon, label: THEME_META.sunset.label },
    { value: "system", icon: Monitor, label: t("system") },
  ];

  const current = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[1];
  const Icon = current.icon;

  function cycleTheme() {
    const idx = THEME_OPTIONS.findIndex((o) => o.value === theme);
    const next = THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length];
    setTheme(next.value);
  }

  return (
    <button
      data-testid="theme-toggle"
      onClick={cycleTheme}
      className="p-1 rounded hover:bg-gray-800 dark:hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
      title={t("toggle", { theme: current.label })}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
