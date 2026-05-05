import { Moon, Sun, Monitor, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useThemeStore } from "../../stores/use-theme-store";
import type { Theme } from "../../stores/use-theme-store";

const THEME_OPTIONS: { value: Theme; icon: typeof Moon; label: string }[] = [
  { value: "light", icon: Sun, label: "亮色" },
  { value: "dark", icon: Moon, label: "暗色" },
  { value: "system", icon: Monitor, label: "跟随系统" },
];

export function ThemeMenu() {
  const theme = useThemeStore((s) => s.theme);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const current = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[1];
  const Icon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        data-testid="theme-menu-toggle"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-gray-400 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        aria-expanded={open}
        aria-label="主题切换"
      >
        <Icon className="w-3 h-3 shrink-0 text-gray-500" />
        <span className="truncate flex-1 text-left">主题: {current.label}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl py-1">
          {THEME_OPTIONS.map((opt) => {
            const isActive = theme === opt.value;
            const OptIcon = opt.icon;
            return (
              <button
                key={opt.value}
                data-testid={`theme-option-${opt.value}`}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                    : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}
                onClick={() => {
                  setTheme(opt.value);
                  setOpen(false);
                }}
              >
                {isActive ? (
                  <Check className="w-3 h-3 shrink-0 text-indigo-500 dark:text-indigo-400" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <OptIcon className="w-3 h-3 shrink-0" />
                <span>{opt.label}</span>
                {opt.value === "system" && (
                  <span className="ml-auto text-[10px] text-gray-400 font-mono">
                    {resolvedTheme}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
