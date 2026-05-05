import { Moon, Sun, Monitor } from "lucide-react";
import { useThemeStore } from "../../stores/use-theme-store";
import type { Theme } from "../../stores/use-theme-store";

const THEME_OPTIONS: { value: Theme; icon: typeof Moon; label: string }[] = [
  { value: "light", icon: Sun, label: "亮色" },
  { value: "dark", icon: Moon, label: "暗色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
];

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

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
      title={`主题: ${current.label}（点击切换）`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}
