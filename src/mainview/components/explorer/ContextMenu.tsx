import { useEffect, useRef, useCallback } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  const adjustedX = useRef(x);
  const adjustedY = useRef(y);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) adjustedX.current = Math.max(0, x - rect.width);
    if (rect.bottom > vh) adjustedY.current = Math.max(0, y - rect.height);
    el.style.left = `${adjustedX.current}px`;
    el.style.top = `${adjustedY.current}px`;
  }, [x, y]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("mousedown", handleClickOutside);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleClickOutside, onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] bg-gray-800 border border-gray-600 rounded-md shadow-xl py-1"
      style={{ left: adjustedX.current, top: adjustedY.current }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && i > 0 && <div className="border-t border-gray-600 my-1" />}
          <button
            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
              item.danger
                ? "text-red-400 hover:bg-red-900/30"
                : "text-gray-200 hover:bg-gray-700"
            }`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon && <span className="w-3.5 shrink-0">{item.icon}</span>}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
