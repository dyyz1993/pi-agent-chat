import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const { t } = useTranslation("explorer");
  const ref = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const newX = rect.right > vw ? Math.max(4, x - rect.width) : x;
    const newY = rect.bottom > vh ? Math.max(4, y - rect.height) : y;
    setPos({ x: newX, y: newY });
  }, [x, y]);

  useEffect(() => {
    const menuItems = ref.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    if (menuItems && menuItems.length > 0) {
      menuItems[0].focus();
    }
  }, []);

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const count = items.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % count);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + count) % count);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const item = items[activeIndex];
        if (item) {
          item.onClick();
          onClose();
        }
      }
    },
    [items, activeIndex, onClose],
  );

  useEffect(() => {
    if (!ref.current) return;
    const menuItems = ref.current.querySelectorAll<HTMLElement>("[role='menuitem']");
    if (menuItems[activeIndex]) {
      menuItems[activeIndex].focus();
    }
  }, [activeIndex]);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [handleClickOutside]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("contextMenu")}
      className="fixed z-50 min-w-[160px] bg-bg-elevated dark:bg-surface-dim border border-border-secondary dark:border-border-secondary rounded-md shadow-xl py-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && i > 0 && (
            <div
              className="border-t border-border-secondary dark:border-border-secondary my-1"
              role="separator"
            />
          )}
          <button
            role="menuitem"
            tabIndex={i === activeIndex ? 0 : -1}
            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors outline-none ${
              i === activeIndex ? "bg-surface-hover dark:bg-surface-hover" : ""
            } ${
              item.danger
                ? "text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 focus:bg-red-50 dark:focus:bg-red-900/30"
                : "text-text-primary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover focus:bg-surface-hover dark:focus:bg-surface-hover"
            }`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            onKeyDown={handleMenuKeyDown}
          >
            {item.icon && <span className="w-3.5 shrink-0">{item.icon}</span>}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
