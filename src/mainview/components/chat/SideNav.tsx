import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  memo,
  useImperativeHandle,
  forwardRef,
} from "react";
import { User, Bot, Type, AlertTriangle, Archive, Brain, type LucideIcon } from "lucide-react";
import type { ChatMessage } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { getToolIcon, getPreviewResourceIcon, getCustomTypeIcon } from "./tool-icon-map";
import { useChatStore } from "../../stores/use-chat-store";
import { useSettingsStore } from "../../stores/use-settings-store";
import { createLogger } from "../../../shared/lib/logger";

const renderLog = createLogger("render-cache");

type FlatItem = { key: string; navId: string; icon: LucideIcon; color: string; blockId?: string };

const MAX_SIDE_NAV_CACHE = 10;

interface FlatItemsCacheEntry {
  ref: ChatMessage[];
  showThinking: boolean;
  result: FlatItem[];
}

const _flatItemsCache = new Map<string, FlatItemsCacheEntry>();

function evictFlatItemsIfNeeded(): void {
  if (_flatItemsCache.size > MAX_SIDE_NAV_CACHE) {
    const firstKey = _flatItemsCache.keys().next().value;
    if (firstKey !== undefined) _flatItemsCache.delete(firstKey);
  }
}

export function clearSideNavCache(sessionId?: string): void {
  if (sessionId) {
    _flatItemsCache.delete(sessionId);
  } else {
    _flatItemsCache.clear();
  }
}

function buildFlatItems(messages: ChatMessage[], showThinking: boolean): FlatItem[] {
  const items: FlatItem[] = [];
  for (const msg of messages) {
    const id = msg.id;

    if (msg.role === "user") {
      items.push({ key: id, navId: id, icon: User, color: "text-semantic-accent" });
      continue;
    }

    if (msg.role === "custom") {
      const cb = msg.content.find((b) => b.type === "custom") as
        | { type: "custom"; customType: string; data: unknown }
        | undefined;
      const ct = cb?.customType ?? "unknown";
      const ie = getCustomTypeIcon(ct);
      items.push({ key: id, navId: id, icon: ie.icon, color: ie.color });
      continue;
    }

    if (msg.role === "compactionSummary") {
      items.push({ key: id, navId: id, icon: Archive, color: "text-semantic-tool" });
      continue;
    }

    const customBlock = msg.content.find((b) => b.type === "custom") as
      | { type: "custom"; customType: string; data: unknown }
      | undefined;
    if (customBlock?.customType === "lsp_diagnostics") {
      items.push({ key: id, navId: id, icon: AlertTriangle, color: "text-status-warning" });
      continue;
    }

    const hasError = msg.content.some((b) =>
      b.type === "toolResult" && b.isError
        ? true
        : b.type === "toolExecution" && b.status === "error",
    );
    const errorColor = hasError ? "text-status-error" : undefined;

    items.push({
      key: `${id}-bot`,
      navId: id,
      icon: Bot,
      color: errorColor ?? "text-status-success",
    });

    let count = 1;
    let hasContentBlock = false;
    let blockIndex = -1;

    for (const b of msg.content) {
      blockIndex++;
      const blockId = `${id}-${blockIndex}`;
      if (b.type === "thinking" && showThinking) {
        count++;
        items.push({
          key: `${id}-${count}`,
          navId: id,
          blockId,
          icon: Brain,
          color: errorColor ?? "text-purple-400",
        });
        hasContentBlock = true;
      } else if (b.type === "text") {
        count++;
        items.push({
          key: `${id}-${count}`,
          navId: id,
          blockId,
          icon: Type,
          color: errorColor ?? "text-text-tertiary",
        });
        hasContentBlock = true;
      } else if (b.type === "toolExecution") {
        count++;
        let ti = getToolIcon(b.toolName);
        if (b.toolName.toLowerCase() === "preview" && (b as { details?: unknown }).details) {
          const rt = (
            (b as { details?: { resourceType?: string } }).details as
              | { resourceType?: string }
              | undefined
          )?.resourceType;
          if (rt) ti = getPreviewResourceIcon(rt);
        }
        items.push({
          key: `${id}-${count}`,
          navId: id,
          blockId,
          icon: ti.icon,
          color: errorColor ?? ti.color,
        });
        hasContentBlock = true;
      }
    }

    if (!hasContentBlock) {
      items.push({ key: id, navId: id, icon: Type, color: errorColor ?? "text-text-tertiary" });
    }
  }

  return items;
}

function NavDot({
  Icon,
  color,
  isActive,
  isMultiSelected,
  dataNavKey,
  onClick,
  onContextMenu,
}: {
  Icon: LucideIcon;
  color: string;
  isActive: boolean;
  isMultiSelected: boolean;
  dataNavKey?: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  let bg = "hover:bg-surface-hover ";
  let barBg = "";
  let iconClr = color;

  if (isMultiSelected) {
    bg = "bg-status-error/25 ";
    barBg = "bg-status-error opacity-100 ";
    iconClr = "text-status-error";
  } else if (isActive) {
    bg = "bg-semantic-accent/25 shadow-[0_0_10px_rgba(99,102,241,0.3)] ";
    barBg = "bg-semantic-accent opacity-100 ";
    iconClr = "text-semantic-accent";
  }

  return (
    <div
      className={`relative w-10 h-8 rounded-r flex items-center justify-center leading-none transition-all cursor-pointer ${bg}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-nav-key={dataNavKey}
    >
      <span
        className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-all opacity-0 ${barBg}`}
      />
      <Icon className={`w-4 h-4 shrink-0 ${iconClr} transition-colors`} />
    </div>
  );
}

export const SideNav = memo(
  forwardRef<
    { getFirstIconId: () => string | null; getLastIconId: () => string | null },
    { messages: ChatMessage[]; onNavDotClick: (navId: string) => void }
  >(function SideNavInner({ messages, onNavDotClick }, ref) {
    const sessionId = useSessionStore((s) => s.activeSessionId);

    const selectedNavId = useTurnStore(
      useCallback(
        (s) => (sessionId ? (s.selectedNavIdBySession[sessionId] ?? null) : null),
        [sessionId],
      ),
    );
    const setNavId = useTurnStore((s) => s.setNavId);
    const selectedItems = useChatNavStore(
      useCallback(
        (s) => (sessionId ? (s.selectedItemsBySession[sessionId] ?? EMPTY_SET) : EMPTY_SET),
        [sessionId],
      ),
    );
    const toggleItemSelect = useChatNavStore((s) => s.toggleItemSelect);

    const showThinking = useSettingsStore((s) => s.showThinking);

    const items = useMemo(() => {
      if (!sessionId) return buildFlatItems(messages, showThinking);
      const cached = _flatItemsCache.get(sessionId);
      if (cached && cached.ref === messages && cached.showThinking === showThinking) {
        renderLog.info("cache HIT (flatItems)", { sessionId, count: messages.length });
        return cached.result;
      }
      const result = buildFlatItems(messages, showThinking);
      renderLog.info("cache MISS (flatItems)", {
        sessionId,
        count: messages.length,
        computeCount: result.length,
      });
      _flatItemsCache.set(sessionId, { ref: messages, showThinking, result });
      evictFlatItemsIfNeeded();
      return result;
    }, [messages, showThinking, sessionId]);
    const itemsRef = useRef(items);
    itemsRef.current = items;

    const scrollRef = useRef<HTMLDivElement>(null);
    const ITEM_HEIGHT = 32;
    const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

    useImperativeHandle(
      ref,
      () => ({
        getFirstIconId: () => items[0]?.key ?? null,
        getLastIconId: () => items[items.length - 1]?.key ?? null,
      }),
      [items],
    );

    const handleClick = useCallback(
      (key: string, navId: string, blockId: string | undefined) => {
        setNavId(key);
        onNavDotClick(blockId ?? navId);
      },
      [onNavDotClick, setNavId],
    );

    const handleContextMenu = useCallback(
      (e: React.MouseEvent, id: string) => {
        e.preventDefault();
        toggleItemSelect(id);
      },
      [toggleItemSelect],
    );

    useEffect(() => {
      if (!selectedNavId) return;
      const container = scrollRef.current;
      const currentItems = itemsRef.current;
      if (!container) return;

      const targetIdx = currentItems.findIndex(
        (item) =>
          item.key === selectedNavId ||
          item.blockId === selectedNavId ||
          item.navId === selectedNavId,
      );
      if (targetIdx === -1) return;

      const totalHeight = currentItems.length * ITEM_HEIGHT;
      if (totalHeight <= container.clientHeight) {
        container.scrollTop = 0;
        return;
      }

      const maxScroll = totalHeight - container.clientHeight;
      const targetScroll = Math.min(Math.max(0, targetIdx * ITEM_HEIGHT), maxScroll);

      if (container.scrollTop !== targetScroll) {
        container.scrollTop = targetScroll;
      }
    }, [selectedNavId]);

    const loadMoreMessages = useChatStore((s) => s.loadMoreMessages);
    const hasMoreMessages = useChatStore(
      useCallback(
        (s) => (sessionId ? (s.hasMoreMessagesBySession[sessionId] ?? false) : false),
        [sessionId],
      ),
    );
    const isLoadingMore = useChatStore(
      useCallback(
        (s) => (sessionId ? (s.isLoadingMoreBySession[sessionId] ?? false) : false),
        [sessionId],
      ),
    );

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) return;
      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          ticking = false;
          if (container.scrollTop < 30 && hasMoreMessages && !isLoadingMore && sessionId) {
            loadMoreMessages(sessionId);
          }
        });
      };
      container.addEventListener("scroll", onScroll, { passive: true });
      return () => container.removeEventListener("scroll", onScroll);
    }, [hasMoreMessages, isLoadingMore, loadMoreMessages, sessionId]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) return;
      const updateRange = () => {
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const BUFFER = 10;
        const start = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
        const end = Math.min(
          items.length,
          Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER,
        );
        setVisibleRange((prev) => {
          if (prev.start === start && prev.end === end) return prev;
          return { start, end };
        });
      };
      updateRange();
      container.addEventListener("scroll", updateRange, { passive: true });
      return () => container.removeEventListener("scroll", updateRange);
    }, [items.length]);

    return (
      <div className="h-full min-h-0 flex flex-col bg-surface-dim/30 dark:bg-surface-code/30 border-l border-border-secondary/30">
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
        >
          <div style={{ height: items.length * ITEM_HEIGHT, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                top: visibleRange.start * ITEM_HEIGHT,
                left: 0,
                right: 0,
              }}
            >
              {items.slice(visibleRange.start, visibleRange.end).map((item, localIndex) => {
                const i = visibleRange.start + localIndex;
                let active = selectedNavId === item.key || selectedNavId === item.blockId;
                if (!active && selectedNavId === item.navId) {
                  active = !items[i - 1] || items[i - 1].navId !== item.navId;
                }
                const multi = selectedItems.has(item.navId);
                return (
                  <NavDot
                    key={item.key}
                    dataNavKey={item.key}
                    Icon={item.icon}
                    color={item.color}
                    isActive={active}
                    isMultiSelected={multi}
                    onClick={() => handleClick(item.key, item.navId, item.blockId)}
                    onContextMenu={(e) => handleContextMenu(e, item.navId)}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {selectedItems.size > 0 && (
          <div className="px-1 py-1 text-[10px] text-status-error text-center border-t border-status-error/20 bg-status-error/5">
            {selectedItems.size} selected
          </div>
        )}
      </div>
    );
  }),
);
