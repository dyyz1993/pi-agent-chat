import { useEffect, useRef, useState, useCallback } from "react";
import { Search, Star, Check, ImageIcon } from "lucide-react";
import { useSessionStore } from "../../stores/use-session-store";
import { AnchoredPopover } from "../primitives";

interface ModelItem {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: ("text" | "image")[];
}

interface ModelPickerButtonProps {
  models: ModelItem[];
  value: string;
  onChange: (value: string) => void;
  placement?: "up" | "down";
  placeholder?: string;
  disabled?: boolean;
  dropdownMinWidth?: number;
  dropdownMaxWidth?: number;
  renderTrigger?: (props: { open: boolean }) => React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  /** Override z-index for nested dropdowns, for example inside another popover. */
  dropdownZIndex?: string;
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
  dropdownMinWidth = 280,
  dropdownMaxWidth,
  renderTrigger,
  onOpenChange,
  dropdownZIndex,
}: ModelPickerButtonProps) {
  const [open, _setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [favoritesFilter, setFavoritesFilter] = useState<"sort" | "only">("sort");
  const favorites = useSessionStore((s) => s.modelFavorites);
  const toggleFavorite = useSessionStore((s) => s.toggleModelFavorite);
  const triggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setOpen = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      _setOpen((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        if (next && !prev) {
          setSearchQuery("");
        }
        if (next !== prev) onOpenChange?.(next);
        return next;
      });
    },
    [onOpenChange],
  );

  // Focus search input when opened (skip on mobile to avoid keyboard popup)
  useEffect(() => {
    if (open && searchInputRef.current && window.innerWidth >= 640) {
      searchInputRef.current.focus();
    }
  }, [open]);

  let displayModels = [...models];
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
  if (favoritesFilter === "only") {
    displayModels = displayModels.filter((m) => favorites.has(modelKey(m)));
  } else {
    displayModels.sort((a, b) => {
      const aFav = favorites.has(modelKey(a)) ? 1 : 0;
      const bFav = favorites.has(modelKey(b)) ? 1 : 0;
      return bFav - aFav;
    });
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
            onClick={() => {
              if (!disabled) setOpen(!open);
            }}
            disabled={disabled}
            className={`w-full flex items-center gap-1.5 h-7 px-2 rounded-md border text-[12px] transition-colors
              ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:border-accent"}
              ${
                open
                  ? "border-accent ring-1 ring-accent/25"
                  : "border-border-secondary"
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

      <AnchoredPopover
        anchorRef={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        placement={placement === "up" ? "top" : "bottom"}
        align="start"
        minWidth={dropdownMinWidth}
        maxWidth={dropdownMaxWidth}
        maxHeight={280}
        zIndex={dropdownZIndex}
        className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl flex flex-col"
        data-model-picker-dropdown
      >
        {/* Search + Favorites filter */}
        <div className="px-2 py-1.5 border-b border-border-secondary/60 shrink-0">
          <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-surface-code/60 border border-border-secondary/50">
            <Search className="w-3 h-3 shrink-0 text-text-tertiary" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="搜索模型..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-[11px] text-text-primary dark:text-text-secondary placeholder-text-tertiary outline-none min-w-0"
            />
            <button
              type="button"
              onClick={() =>
                setFavoritesFilter((v) => (v === "sort" ? "only" : "sort"))
              }
              className={`p-0.5 rounded transition-colors shrink-0 ${
                favoritesFilter === "only"
                  ? "text-accent"
                  : favoritesFilter === "sort" && favorites.size > 0
                    ? "text-accent/60"
                    : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary"
              }`}
              title={favoritesFilter === "only" ? "收藏置顶" : "仅显示收藏"}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  favoritesFilter === "only"
                    ? "fill-accent"
                    : favoritesFilter === "sort" && favorites.size > 0
                      ? "fill-accent/30"
                      : ""
                }`}
              />
            </button>
          </div>
        </div>

        {/* Model list */}
        <div className="overflow-y-auto overflow-x-hidden flex-1 py-1">
          {models.length === 0 ? (
            <div className="text-text-tertiary text-xs text-center py-3">没有可用模型</div>
          ) : displayModels.length === 0 ? (
            <div className="text-text-tertiary text-xs text-center py-3">
              {favoritesFilter === "only" ? "没有收藏的模型" : "无匹配结果"}
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
                      ? "bg-accent/10"
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
                      <Check className="w-3 h-3 shrink-0 text-accent" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className={`truncate text-xs ${isSelected ? "text-accent font-medium" : ""}`}>{m.name ?? formatModelName(m.id)}</span>
                      <span className="text-[10px] text-text-tertiary font-mono truncate">
                        {m.provider} · {m.id}
                      </span>
                    </div>
                  </button>
                  {m.input?.includes("image") && (
                    <span title="支持图片输入">
                      <ImageIcon className="w-3 h-3 text-text-tertiary shrink-0" />
                    </span>
                  )}
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
                      className={`w-3 h-3 ${isFav ? "fill-accent text-accent" : "text-text-tertiary hover:text-text-secondary"}`}
                    />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </AnchoredPopover>
    </>
  );
}
