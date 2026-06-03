import { Moon, Sun, Monitor, Check, Languages } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore, THEME_META } from "../../stores/use-theme-store";
import type { Theme } from "../../stores/use-theme-store";

const THEME_DOT_COLORS: Record<Exclude<Theme, "system">, string> = {
  light: "bg-white border border-border-secondary",
  dark: "bg-surface-code",
  nord: "bg-[#5e81ac]",
  solarized: "bg-[#b58900]",
  "warm-dark": "bg-[#d4956a]",
  rose: "bg-[#c4a7e7]",
  latte: "bg-[#dd7878]",
  sunset: "bg-[#e8984a]",
};

export function ThemeMenu() {
  const { t } = useTranslation("theme");
  const theme = useThemeStore((s) => s.theme);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useThemeStore((s) => s.language);
  const setLanguage = useThemeStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const LANGUAGE_OPTIONS = [
    { value: "zh-CN", label: t("chinese") },
    { value: "en", label: t("english") },
  ];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
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
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover dark:hover:bg-surface-dim/60 hover:text-text-primary dark:hover:text-text-secondary transition-colors"
        aria-expanded={open}
        aria-label={t("ariaThemeSwitch")}
      >
        <Icon className="w-3 h-3 shrink-0 text-text-tertiary" />
        <span className="truncate flex-1 text-left">
          {t("switchLabel")} {current.label}
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-popover bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl py-1">
          <div className="px-3 py-1 text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
            Theme
          </div>
          {THEME_OPTIONS.map((opt) => {
            const isActive = theme === opt.value;
            const OptIcon = opt.icon;
            const dot =
              opt.value !== "system"
                ? THEME_DOT_COLORS[opt.value as Exclude<Theme, "system">]
                : null;
            return (
              <button
                key={opt.value}
                data-testid={`theme-option-${opt.value}`}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                    : "text-text-secondary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
                }`}
                onClick={() => {
                  setTheme(opt.value);
                }}
              >
                {isActive ? (
                  <Check className="w-3 h-3 shrink-0 text-indigo-500 dark:text-indigo-400" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <OptIcon className="w-3 h-3 shrink-0" />
                <span>{opt.label}</span>
                {dot && <span className={`w-2 h-2 rounded-full shrink-0 ml-auto ${dot}`} />}
                {opt.value === "system" && (
                  <span className="ml-auto text-[10px] text-text-tertiary font-mono">
                    {resolvedTheme}
                  </span>
                )}
              </button>
            );
          })}
          <div className="my-1 border-t border-border-secondary" />
          <div className="px-3 py-1 text-[10px] font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Languages className="w-3 h-3" />
            Language
          </div>
          {LANGUAGE_OPTIONS.map((opt) => {
            const isActive = language === opt.value;
            return (
              <button
                key={opt.value}
                data-testid={`lang-option-${opt.value}`}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                  isActive
                    ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                    : "text-text-secondary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setLanguage(opt.value);
                }}
              >
                {isActive ? (
                  <Check className="w-3 h-3 shrink-0 text-indigo-500 dark:text-indigo-400" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span>{opt.label}</span>
                {isActive && (
                  <span className="ml-auto text-[10px] text-text-tertiary font-mono">
                    {opt.value}
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
