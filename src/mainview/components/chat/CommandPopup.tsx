import { useRef, useEffect, useState, useMemo } from "react";
import {
  Bot,
  File,
  Folder,
  Sparkles,
  Puzzle,
  FileText,
  ChevronRight,
  X,
  Loader2,
  Brain,
  BookOpen,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PopupItem, FileBreadcrumb, PopupMode, AtTab } from "../../hooks/use-command-popup";

interface CommandPopupProps {
  popupMode: PopupMode;
  atTab: AtTab;
  items: PopupItem[];
  loading: boolean;
  activeIndex: number;
  query: string;
  fileBreadcrumbs: FileBreadcrumb[];
  onSetAtTab: (tab: AtTab) => void;
  onSelect: (item: PopupItem) => void;
  onClose: () => void;
  onBreadcrumb: (idx: number) => void;
  onListKeyDown: (e: React.KeyboardEvent) => void;
  onSetActiveIndex: (idx: number) => void;
}

const AT_TABS: { key: AtTab; labelKey: string }[] = [
  { key: "agents", labelKey: "quickAction.agents" },
  { key: "files", labelKey: "quickAction.files" },
  { key: "memory", labelKey: "quickAction.memory" },
];

function renderIcon(icon: PopupItem["icon"]) {
  switch (icon) {
    case "bot":
      return <Bot className="w-4 h-4" />;
    case "file":
      return <File className="w-4 h-4" />;
    case "folder":
      return <Folder className="w-4 h-4" />;
    case "sparkles":
      return <Sparkles className="w-4 h-4" />;
    case "puzzle":
      return <Puzzle className="w-4 h-4" />;
    case "filetext":
      return <FileText className="w-4 h-4" />;
    case "brain":
      return <Brain className="w-4 h-4" />;
    case "book":
      return <BookOpen className="w-4 h-4" />;
  }
}

export function CommandPopup({
  popupMode,
  atTab,
  items,
  loading,
  activeIndex,
  query,
  fileBreadcrumbs,
  onSetAtTab,
  onSelect,
  onClose,
  onBreadcrumb,
  onListKeyDown,
  onSetActiveIndex,
}: CommandPopupProps): JSX.Element | null {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    if (!popupMode) return;

    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [popupMode, onClose]);

  useEffect(() => {
    setSearchText("");
  }, [popupMode]);

  useEffect(() => {
    if (popupMode === "slash" && searchRef.current) {
      searchRef.current.focus();
    }
  }, [popupMode]);

  const filteredItems = useMemo(() => {
    if (!searchText.trim()) return items;
    const q = searchText.toLowerCase();
    return items.filter(
      (it) =>
        it.label.toLowerCase().includes(q) ||
        (it.description && it.description.toLowerCase().includes(q)),
    );
  }, [items, searchText]);

  if (!popupMode) return null;

  return (
    <div
      ref={panelRef}
      className="absolute left-0 right-0 bottom-full mb-2 max-w-md mx-auto bg-surface-dim dark:bg-surface-code border border-border-secondary rounded-lg shadow-xl shadow-black/40 overflow-hidden z-50"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-secondary">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {popupMode === "at" ? (
            <div className="flex gap-1 shrink-0">
              {AT_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => onSetAtTab(tab.key)}
                  className={`px-2.5 py-0.5 rounded text-xs transition-colors whitespace-nowrap ${
                    atTab === tab.key
                      ? "bg-semantic-accent/30 text-semantic-accent"
                      : "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-dim dark:hover:bg-surface-dim"
                  }`}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t("quickAction.searchPlaceholder")}
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary dark:placeholder:text-text-tertiary outline-none min-w-0"
              />
            </div>
          )}
          {loading && <Loader2 className="w-3.5 h-3.5 text-text-tertiary animate-spin shrink-0" />}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-dim dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors shrink-0 ml-1"
          title={t("common:close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {popupMode === "at" && atTab === "files" && fileBreadcrumbs.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border-secondary/40 text-xs overflow-x-auto">
          <button
            onClick={() => onBreadcrumb(-1)}
            className="text-semantic-accent hover:text-semantic-accent shrink-0"
          >
            {t("quickAction.rootDir")}
          </button>
          {fileBreadcrumbs.map((bc, i) => (
            <span key={bc.path} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="w-3 h-3 text-text-tertiary" />
              <button
                onClick={() => onBreadcrumb(i)}
                className={`${
                  i === fileBreadcrumbs.length - 1
                    ? "text-text-secondary"
                    : "text-semantic-accent hover:text-semantic-accent"
                }`}
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="max-h-[240px] min-h-[80px] overflow-y-auto" role="listbox">
        {filteredItems.length === 0 && !loading && (
          <div className="px-3 py-6 text-center text-xs text-text-tertiary">
            {searchText || query ? t("quickAction.noMatchResults") : t("common:noData")}
          </div>
        )}
        {filteredItems.map((item, idx) => (
          <button
            key={item.id}
            role="option"
            aria-selected={idx === activeIndex}
            tabIndex={idx === activeIndex ? 0 : -1}
            onClick={() => onSelect(item)}
            onKeyDown={onListKeyDown}
            onMouseEnter={() => onSetActiveIndex(idx)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
              idx === activeIndex
                ? "bg-surface-code/80 dark:bg-surface-dim/80"
                : "hover:bg-surface-code/50 dark:hover:bg-surface-dim/50"
            }`}
          >
            <div className={`shrink-0 ${item.accentColor}`}>{renderIcon(item.icon)}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text-primary truncate">{item.label}</div>
              {item.description && !item.isFolder && (
                <div className="text-[11px] text-text-tertiary truncate">{item.description}</div>
              )}
            </div>
            {item.isFolder && <ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}
