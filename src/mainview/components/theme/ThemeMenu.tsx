import { Moon, Sun, Check, Languages } from "lucide-react";
import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useThemeStore, THEME_META } from "../../stores/use-theme-store";
import type { Theme } from "../../stores/use-theme-store";
import { Button, AnchoredPopover } from "../primitives";

const THEME_DOT_COLORS: Record<Theme, string> = {
  light: "bg-white border border-border-secondary",
  dark: "bg-bg-elevated border border-border-secondary",
};

const menuIconSlot = "flex h-4 w-4 shrink-0 items-center justify-center";

export function ThemeMenu() {
  const { t } = useTranslation("theme");
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const language = useThemeStore((s) => s.language);
  const setLanguage = useThemeStore((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const THEME_OPTIONS: { value: Theme; icon: typeof Moon; label: string }[] = [
    { value: "light", icon: Sun, label: THEME_META.light.label },
    { value: "dark", icon: Moon, label: THEME_META.dark.label },
  ];

  const LANGUAGE_OPTIONS = [
    { value: "zh-CN", label: t("chinese") },
    { value: "en", label: t("english") },
  ];

  const current = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[1];
  const Icon = current.icon;
  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        data-testid="theme-menu-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-text-tertiary hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 hover:text-text-secondary dark:hover:text-text-secondary transition-colors whitespace-nowrap"
        aria-expanded={open}
        aria-label={t("ariaThemeSwitch")}
      >
        <Icon className="w-3 h-3 shrink-0 text-text-tertiary" />
        <span className="min-w-0 truncate flex-1 text-left">
          {t("switchLabel")} {current.label}
        </span>
      </button>
      <AnchoredPopover
        anchorRef={buttonRef}
        open={open}
        onClose={() => setOpen(false)}
        placement="top"
        align="stretch"
        className="bg-bg-elevated border border-border-secondary rounded-lg shadow-floating overflow-hidden"
      >
        <div className="py-1">
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
                    ? "bg-accent/10 text-accent-text"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
                onClick={() => {
                  setTheme(opt.value);
                }}
              >
                <span className={menuIconSlot}>
                  {isActive && <Check className="w-3 h-3 text-accent-text" />}
                </span>
                <span className={menuIconSlot}>
                  <OptIcon className="w-3.5 h-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{opt.label}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ml-auto ${dot}`} />
              </Button>
            );
          })}
          <div className="my-1 border-t border-border-secondary" />
          <div className="px-3 py-1 text-xs font-medium text-text-tertiary uppercase tracking-wider flex items-center gap-2">
            <span className={menuIconSlot}>
              <Languages className="w-3.5 h-3.5" />
            </span>
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
                    ? "bg-accent/10 text-accent-text"
                    : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                }`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setLanguage(opt.value);
                }}
              >
                <span className={menuIconSlot}>
                  {isActive && <Check className="w-3 h-3 text-accent-text" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{opt.label}</span>
                {isActive && (
                  <span className="ml-auto text-xs text-text-tertiary font-mono">{opt.value}</span>
                )}
              </Button>
            );
          })}
        </div>
      </AnchoredPopover>
    </div>
  );
}
