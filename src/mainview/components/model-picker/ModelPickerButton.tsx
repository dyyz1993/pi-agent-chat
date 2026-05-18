import { useEffect, useRef, useState, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Star, Check } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";

interface ModelItem {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
}

interface ModelPickerButtonProps {
  models: ModelItem[];
  value: string;
  onChange: (value: string) => void;
  placement?: "up" | "down";
  placeholder?: string;
  disabled?: boolean;
  renderTrigger?: (props: { open: boolean }) => React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}

function modelKey(m: ModelItem): string {
  return `${m.provider}/${m.id}`;
}

function formatModelName(modelId: string): string {
  return modelId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ModelPickerButton({
  models,
  value,
  onChange,
  placement = "down",
  placeholder = "--",
  disabled = false,
  renderTrigger,
  onOpenChange,
}: ModelPickerButtonProps) {
  const [open, _setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const favorites = useSessionStore((s) => s.modelFavorites);
  const toggleFavorite = useSessionStore((s) => s.toggleModelFavorite);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      _setOpen((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        if (next && !prev) {
          setSearchQuery("");
          if (useSessionStore.getState().modelFavorites.size > 0) {
            setShowFavoritesOnly(true);
          }
        }
        if (next !== prev) onOpenChange?.(next);
        return next;
      });
    },
    [onOpenChange],
  );

  // Compute portal dropdown position from trigger rect
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownMaxH = 280;
    const minDropdownWidth = 280;
    const dropdownWidth = Math.max(rect.width, minDropdownWidth);
    const style: React.CSSProperties = {
      position: "fixed",
      left: Math.max(4, Math.min(rect.left, window.innerWidth - dropdownWidth - 4)),
      width: dropdownWidth,
      maxHeight: dropdownMaxH,
      zIndex: 9999,
    };
    if (placement === "up") {
      const spaceAbove = rect.top;
      const top = Math.max(4, rect.top - dropdownMaxH - 4);
      if (spaceAbove < dropdownMaxH) {
        style.top = top;
        style.maxHeight = rect.top - 8;
      } else {
        style.bottom = window.innerHeight - rect.top + 4;
      }
    } else {
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < dropdownMaxH) {
        style.bottom = 4;
        style.maxHeight = window.innerHeight - rect.bottom - 8;
      } else {
        style.top = rect.bottom + 4;
      }
    }
    setDropdownStyle(style);
  }, [open, placement]);

  // Focus search input when opened (skip on mobile to avoid keyboard popup)
  useEffect(() => {
    if (open && searchInputRef.current && window.innerWidth >= 640) {
      searchInputRef.current.focus();
    }
  }, [open]);

  // Close on click outside (both trigger and dropdown)
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, setOpen]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, setOpen]);

  let displayModels = models;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    displayModels = displayModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.name?.toLowerCase().includes(q) ?? false) ||
        formatModelName(m.id).toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }
  if (showFavoritesOnly) {
    displayModels = displayModels.filter((m) => favorites.has(modelKey(m)));
  }

  const selectedModel = models.find((m) => modelKey(m) === value);
  const modelName = selectedModel?.name ?? (selectedModel ? formatModelName(selectedModel.id) : "");
  const displayName = selectedModel ? `${selectedModel.provider}/${modelName}` : "";

  return (
    <>
      <div ref={triggerRef}>
        {renderTrigger ? (
          <div
            onClick={() => !disabled && setOpen((o) => !o)}
            className={disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
          >
            {renderTrigger({ open })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => !disabled && setOpen(!open)}
            disabled={disabled}
            className={`w-full flex items-center gap-1.5 h-7 px-2 rounded-md border text-[12px] transition-colors
              ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:border-semantic-accent"}
              ${
                open
                  ? "border-semantic-accent ring-1 ring-semantic-accent/30"
                  : "border-border-secondary dark:border-border-secondary"
              }
               bg-bg-elevated dark:bg-surface-dim text-text-secondary dark:text-text-secondary`}
          >
            <span className="truncate flex-1 text-left">{displayName || placeholder}</span>
            <svg
              className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform ${open ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {open &&
        createPortal(
          <div
            ref={dropdownRef}
            data-model-picker-dropdown
            className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary dark:border-border-secondary rounded-md shadow-xl flex flex-col"
            style={dropdownStyle}
          >
            {/* Search + Favorites filter */}
            <div className="px-2 py-1.5 border-b border-border-secondary/60 dark:border-border-secondary/60 shrink-0">
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-surface-code/60 dark:bg-surface-code/60 border border-border-secondary/50 dark:border-border-secondary/50">
                <Search className="w-3 h-3 shrink-0 text-text-tertiary dark:text-text-tertiary" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="搜索模型..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[11px] text-text-primary dark:text-text-secondary placeholder-text-tertiary dark:placeholder-text-tertiary outline-none min-w-0"
                />
                <button
                  type="button"
                  onClick={() => setShowFavoritesOnly((v) => !v)}
                  className={`p-0.5 rounded transition-colors shrink-0 ${
                    showFavoritesOnly
                      ? "text-status-warning"
                      : "text-text-tertiary dark:text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary"
                  }`}
                  title={showFavoritesOnly ? "显示全部" : "仅显示收藏"}
                >
                  <Star
                    className={`w-3.5 h-3.5 ${showFavoritesOnly ? "fill-status-warning" : ""}`}
                  />
                </button>
              </div>
            </div>

            {/* Model list */}
            <div className="overflow-y-auto flex-1 py-1">
              {models.length === 0 ? (
                <div className="text-text-tertiary dark:text-text-tertiary text-xs text-center py-3">
                  没有可用模型
                </div>
              ) : displayModels.length === 0 ? (
                <div className="text-text-tertiary dark:text-text-tertiary text-xs text-center py-3">
                  {showFavoritesOnly ? "没有收藏的模型" : "无匹配结果"}
                </div>
              ) : (
                displayModels.map((m) => {
                  const key = modelKey(m);
                  const isSelected = key === value;
                  const isFav = favorites.has(key);
                  return (
                    <div
                      key={key}
                      className={`flex items-center px-2 py-1.5 transition-colors ${
                        isSelected
                          ? "bg-semantic-accent/15 text-semantic-accent"
                          : "text-text-secondary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onChange(key);
                          setOpen(false);
                        }}
                        className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      >
                        {isSelected ? (
                          <Check className="w-3 h-3 shrink-0 text-semantic-accent" />
                        ) : (
                          <span className="w-3 shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="truncate text-xs">
                            {m.name ?? formatModelName(m.id)}
                          </span>
                          <span className="text-[10px] text-semantic-tool/60 font-mono">
                            {m.provider} · {m.id}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(key);
                        }}
                        className="p-0.5 rounded hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 transition-all shrink-0"
                        title={isFav ? "取消收藏" : "收藏"}
                      >
                        <Star
                          className={`w-3 h-3 ${isFav ? "fill-status-warning text-status-warning" : "text-text-tertiary dark:text-text-tertiary"}`}
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
