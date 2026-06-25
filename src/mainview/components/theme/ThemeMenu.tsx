import { Moon, Sun, Check, Languages } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore, THEME_META } from "../../stores/use-theme-store";
import type { Theme } from "../../stores/use-theme-store";
import { Button } from "../primitives";

const THEME_DOT_COLORS: Record<Theme, string> = {
  light: "bg-white border border-border-secondary",
  dark: "bg-[#101722] border border-border-secondary",
};

export function ThemeMenu() {
  const { t } = useTranslation("theme");
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useThemeStore((s) => s.language);
  const setLanguage = useThemeStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const THEME_OPTIONS: { value: Theme; icon: typeof Moon; label: string }[] = [
    { value: "light", icon: Sun, label: THEME_META.light.label },
    { value: "dark", icon: Moon, label: THEME_META.dark.label },
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
      <Button
        data-testid="theme-menu-toggle"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="w-full justify-start px-2 py-1.5 text-text-tertiary hover:text-text-primary"
        aria-expanded={open}
        aria-label={t("ariaThemeSwitch")}
      >
        <Icon className="w-3 h-3 shrink-0 text-text-tertiary" />
        <span className="truncate flex-1 text-left">
          {t("switchLabel")} {current.label}
        </span>
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-popover bg-bg-elevated border border-border-secondary rounded-lg shadow-floating py-1">
          <div className="px-3 py-1 text-xs font-medium text-text-tertiary uppercase tracking-wider">
            Theme
          </div>
          {THEME_OPTIONS.map((opt) => {
            const isActive = theme === opt.value;
            const OptIcon = opt.icon;
            const dot = THEME_DOT_COLORS[opt.value];
            return (
              <Button
                key={opt.value}
                data-testid={`theme-option-${opt.value}`}
                variant="ghost"
                size="sm"
                className={`w-full justify-start rounded-none px-3 py-1.5 text-left ${
                  isActive
                    ? "bg-semantic-accent/10 text-accent-text"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
                onClick={() => {
                  setTheme(opt.value);
                }}
              >
                {isActive ? (
                  <Check className="w-3 h-3 shrink-0 text-accent-text" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <OptIcon className="w-3 h-3 shrink-0" />
                <span>{opt.label}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ml-auto ${dot}`} />
              </Button>
            );
          })}
          <div className="my-1 border-t border-border-secondary" />
          <div className="px-3 py-1 text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-1">
            <Languages className="w-3 h-3" />
            Language
          </div>
          {LANGUAGE_OPTIONS.map((opt) => {
            const isActive = language === opt.value;
            return (
              <Button
                key={opt.value}
                data-testid={`lang-option-${opt.value}`}
                variant="ghost"
                size="sm"
                className={`w-full justify-start rounded-none px-3 py-1.5 text-left ${
                  isActive
                    ? "bg-semantic-accent/10 text-accent-text"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setLanguage(opt.value);
                }}
              >
                {isActive ? (
                  <Check className="w-3 h-3 shrink-0 text-accent-text" />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <span>{opt.label}</span>
                {isActive && (
                  <span className="ml-auto text-xs text-text-tertiary font-mono">{opt.value}</span>
                )}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
