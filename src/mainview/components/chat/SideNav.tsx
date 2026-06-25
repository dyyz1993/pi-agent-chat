import {
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  memo,
  useImperativeHandle,
  forwardRef,
} from "react";
import { User, Bot, AlertTriangle, Archive, Brain, FileText, type LucideIcon } from "lucide-react";
import type { ChatMessage, ContentBlock } from "../../types";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import {
  getCustomTypeIcon,
  getPreviewResourceIcon,
  getToolIcon,
  getUIMethodIcon,
  hasCustomTypeIcon,
} from "./tool-icon-map";
import { useSettingsStore } from "../../stores/use-settings-store";
import { useAgentStore, type AgentAvatar as AgentAvatarValue } from "../../stores/use-agent-store";
import { dedupeMemoryInjectMessages } from "../../stores/use-chat-store";
import { createLogger } from "../../../shared/lib/logger";
import { ALL_MEMORY_TYPE_KEYS } from "./memory-config";
import { AgentAvatar } from "../agent-avatar/AgentAvatar";
import { MEMORY_HIDDEN_IN_CHAT, isLspCustomType, isLspVisibleInChat } from "./lsp-constants";
import { isBashBackgroundProcessType } from "./bash-background-process";

const renderLog = createLogger("render-cache");

export type FlatItem = {
  key: string;
  navId: string;
  icon: LucideIcon;
  color: string;
  blockId?: string;
  useAgentAvatar?: boolean;
};

export type SideNavActiveTarget = {
  key: string;
  messageId: string;
  blockId?: string;
};

export type SideNavTarget = {
  messageId: string;
  blockId?: string;
};

export type SideNavPagination = {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
};

const MAX_SIDE_NAV_CACHE = 10;
const FLAT_ITEMS_CACHE_VERSION = 2;

interface FlatItemsCacheEntry {
  version: number;
  ref: ChatMessage[];
  showThinking: boolean;
  showMemoryEntries: boolean;
  showToolCalls: boolean;
  showToolResults: boolean;
  collapsedMessageIds: ReadonlySet<string>;
  result: FlatItem[];
}

const _flatItemsCache = new Map<string, FlatItemsCacheEntry>();

const SIDE_NAV_ITEM_HEIGHT = 32;
const SIDE_NAV_SCROLL_MARGIN = 48;
const SIDE_NAV_FOLLOW_MARGIN = 0;
const SIDE_NAV_COMPACT_GAP = 8;
const SIDE_NAV_MIN_VIEWPORT_PADDING = 12;
const SIDE_NAV_CLICK_SCROLL_SUPPRESS_MS = 1000;
const SIDE_NAV_ACTIVE_SETTLE_DELAYS_MS = [80, 240] as const;
const SIDE_NAV_INITIAL_ACTIVE_SETTLE_DELAYS_MS = [80, 240, 600, 1200, 2200] as const;
type SideNavScrollStrategy = "center" | "edge";

export type SideNavViewportMetrics = {
  gap: number;
  viewportHeight: number;
  visibleItemCount: number;
};

export function getSideNavViewportMetrics(
  containerHeight: number,
  itemCount = Number.POSITIVE_INFINITY,
  itemHeight = SIDE_NAV_ITEM_HEIGHT,
  _minPadding = SIDE_NAV_MIN_VIEWPORT_PADDING,
): SideNavViewportMetrics {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return { gap: 0, viewportHeight: 0, visibleItemCount: 0 };
  }
  if (containerHeight <= itemHeight) {
    return { gap: 0, viewportHeight: containerHeight, visibleItemCount: 1 };
  }

  const visibleItemCount = Math.max(1, Math.floor(containerHeight / itemHeight));
  if (Number.isFinite(itemCount) && itemCount <= visibleItemCount) {
    return {
      gap: SIDE_NAV_COMPACT_GAP,
      viewportHeight: containerHeight,
      visibleItemCount,
    };
  }

  const totalItemHeight = visibleItemCount * itemHeight;
  const leftover = Math.max(0, containerHeight - totalItemHeight);
  const gap = visibleItemCount > 1 ? Math.floor(leftover / (visibleItemCount - 1)) : 0;
  return {
    gap,
    viewportHeight: totalItemHeight,
    visibleItemCount,
  };
}

export function getSideNavViewportPadding(
  containerHeight: number,
  itemCount = Number.POSITIVE_INFINITY,
  itemHeight = SIDE_NAV_ITEM_HEIGHT,
  minPadding = SIDE_NAV_MIN_VIEWPORT_PADDING,
): number {
  return getSideNavViewportMetrics(containerHeight, itemCount, itemHeight, minPadding).gap;
}

export function getSideNavScrollTarget(
  container: Pick<HTMLElement, "scrollTop" | "clientHeight"> &
    Partial<Pick<HTMLElement, "scrollHeight">>,
  item: Pick<HTMLElement, "offsetTop" | "offsetHeight">,
  margin = SIDE_NAV_SCROLL_MARGIN,
  strategy: SideNavScrollStrategy = "center",
): number | null {
  const viewportTop = container.scrollTop;
  const viewportBottom = viewportTop + container.clientHeight;
  const itemTop = item.offsetTop;
  const itemBottom = itemTop + item.offsetHeight;
  const itemHeight = item.offsetHeight;
  const comfortMargin = Math.min(margin, Math.max(0, (container.clientHeight - itemHeight) / 2));
  const comfortTop = viewportTop + comfortMargin;
  const comfortBottom = viewportBottom - comfortMargin;
  const maxScrollTop =
    typeof container.scrollHeight === "number"
      ? Math.max(0, container.scrollHeight - container.clientHeight)
      : Number.POSITIVE_INFINITY;
  const clampScrollTop = (value: number) => Math.max(0, Math.min(value, maxScrollTop));

  if (itemTop >= comfortTop && itemBottom <= comfortBottom) return null;

  if (strategy === "edge") {
    const edgeTop =
      itemTop < comfortTop
        ? itemTop - comfortMargin
        : itemBottom - container.clientHeight + comfortMargin;
    return clampScrollTop(edgeTop);
  }

  const centeredTop = itemTop - Math.max(0, (container.clientHeight - itemHeight) / 2);
  return clampScrollTop(centeredTop);
}

export function getSideNavVisibleEdgeFallbackKey(
  container: HTMLElement,
  activeKey: string | null,
): string | null {
  if (!activeKey) return null;
  const dots = Array.from(container.querySelectorAll<HTMLElement>("[data-nav-key]"));
  const activeEl = dots.find((dot) => dot.dataset.navKey === activeKey);
  if (!activeEl) return null;

  const containerRect = container.getBoundingClientRect();
  const activeRect = activeEl.getBoundingClientRect();
  if (activeRect.bottom > containerRect.top && activeRect.top < containerRect.bottom) {
    return null;
  }

  const visibleDots = dots.filter((dot) => {
    const rect = dot.getBoundingClientRect();
    return rect.bottom > containerRect.top + 0.5 && rect.top < containerRect.bottom - 0.5;
  });
  if (visibleDots.length === 0) return null;

  if (activeRect.bottom <= containerRect.top) {
    return visibleDots[0].dataset.navKey ?? null;
  }
  if (activeRect.top >= containerRect.bottom) {
    return visibleDots[visibleDots.length - 1].dataset.navKey ?? null;
  }
  return null;
}

function scrollSideNavItemIntoView(
  container: HTMLElement,
  item: HTMLElement,
  behavior: ScrollBehavior,
  strategy: SideNavScrollStrategy = "center",
  margin = SIDE_NAV_SCROLL_MARGIN,
): void {
  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const visualHeight = containerRect.height || container.clientHeight;
  const hasMeasuredItemRect = itemRect.height > 0 || itemRect.top !== 0 || containerRect.top !== 0;
  const itemTop = hasMeasuredItemRect
    ? container.scrollTop + itemRect.top - containerRect.top
    : item.offsetTop;
  const targetTop = getSideNavScrollTarget(
    {
      scrollTop: container.scrollTop,
      clientHeight: visualHeight,
      scrollHeight: container.scrollHeight,
    },
    {
      offsetTop: itemTop,
      offsetHeight: itemRect.height || item.offsetHeight,
    },
    margin,
    strategy,
  );
  if (targetTop == null) return;
  container.scrollTo({ top: targetTop, behavior });
}

function findSideNavItemByKey(container: HTMLElement, key: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>("[data-nav-key]")).find(
      (item) => item.dataset.navKey === key,
    ) ?? null
  );
}

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

export function buildFlatItems(
  messages: ChatMessage[],
  showThinking: boolean,
  showMemoryEntries = false,
  collapsedMessageIds: ReadonlySet<string> = EMPTY_SET,
  showToolCalls = true,
  showToolResults = true,
): FlatItem[] {
  const items: FlatItem[] = [];
  for (const msg of dedupeMemoryInjectMessages(messages)) {
    const id = msg.id;

    if (msg.role === "user") {
      items.push({
        key: id,
        navId: id,
        icon: User,
        color: "text-semantic-accent",
      });
      continue;
    }

    if (msg.role === "custom") {
      const cb = msg.content.find((b) => b.type === "custom") as
        | { type: "custom"; customType: string; data: unknown }
        | undefined;
      const ct = cb?.customType ?? "unknown";
      if (ALL_MEMORY_TYPE_KEYS.has(ct) && !showMemoryEntries) continue;
      if (!hasCustomTypeIcon(ct)) continue;
      const ie = getCustomTypeIcon(ct);
      items.push({ key: id, navId: id, icon: ie.icon, color: ie.color });
      continue;
    }

    if (msg.role === "compactionSummary") {
      items.push({ key: id, navId: id, icon: Archive, color: "text-semantic-tool" });
      continue;
    }

    const isCollapsed = collapsedMessageIds.has(id);

    const customBlock = msg.content.find((b) => b.type === "custom") as
      | { type: "custom"; customType: string; data: unknown }
      | undefined;
    if (customBlock && ALL_MEMORY_TYPE_KEYS.has(customBlock.customType) && !showMemoryEntries) {
      continue;
    }
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
      key: id,
      navId: id,
      icon: Bot,
      color: errorColor ?? "text-status-success",
      useAgentAvatar: true,
    });

    if (isCollapsed) continue;

    for (let i = 0; i < msg.content.length; i++) {
      const block = msg.content[i];
      const blockItem = buildBlockItem(id, i, block, {
        showThinking,
        showMemoryEntries,
        showToolCalls,
        showToolResults,
        forceError: hasError,
      });
      if (blockItem) items.push(blockItem);
    }
  }

  return items;
}

function buildBlockItem(
  msgId: string,
  blockIndex: number,
  block: ContentBlock,
  options: {
    showThinking: boolean;
    showMemoryEntries: boolean;
    showToolCalls: boolean;
    showToolResults: boolean;
    forceError: boolean;
  },
): FlatItem | null {
  const blockId = `${msgId}-${blockIndex}`;
  const key = blockId;
  const errorColor = options.forceError ? "text-status-error" : undefined;

  switch (block.type) {
    case "text":
      return {
        key,
        navId: msgId,
        blockId,
        icon: FileText,
        color: errorColor ?? "text-text-tertiary",
      };
    case "thinking":
      if (!options.showThinking) return null;
      return {
        key,
        navId: msgId,
        blockId,
        icon: Brain,
        color: errorColor ?? "text-semantic-memory",
      };
    case "toolCall":
      if (!options.showToolCalls) return null;
      {
        const entry = getToolIcon(block.name);
        return {
          key,
          navId: msgId,
          blockId,
          icon: entry.icon,
          color: errorColor ?? entry.color,
        };
      }
    case "toolExecution":
      if (!options.showToolCalls) return null;
      {
        const entry = getToolIcon(block.toolName);
        const isError = block.status === "error";
        return {
          key,
          navId: msgId,
          blockId,
          icon: entry.icon,
          color: isError ? "text-status-error" : (errorColor ?? entry.color),
        };
      }
    case "toolResult":
      if (!options.showToolResults) return null;
      {
        const entry = getToolIcon(block.toolName);
        return {
          key,
          navId: msgId,
          blockId,
          icon: entry.icon,
          color: block.isError ? "text-status-error" : (errorColor ?? entry.color),
        };
      }
    case "custom":
      if (ALL_MEMORY_TYPE_KEYS.has(block.customType) && !options.showMemoryEntries) return null;
      if (MEMORY_HIDDEN_IN_CHAT.has(block.customType)) return null;
      if (isLspCustomType(block.customType) && !isLspVisibleInChat(block.customType)) return null;
      if (!hasCustomTypeIcon(block.customType) && !isBashBackgroundProcessType(block.customType)) {
        return null;
      }
      {
        const entry = getCustomTypeIcon(block.customType);
        return {
          key,
          navId: msgId,
          blockId,
          icon: entry.icon,
          color: errorColor ?? entry.color,
        };
      }
    case "compactionSummary":
      return {
        key,
        navId: msgId,
        blockId,
        icon: Archive,
        color: errorColor ?? "text-semantic-tool",
      };
    case "imageBlock": {
      const entry = getPreviewResourceIcon("image");
      return {
        key,
        navId: msgId,
        blockId,
        icon: entry.icon,
        color: errorColor ?? entry.color,
      };
    }
    case "uiInteraction": {
      const entry = getUIMethodIcon(block.method);
      return {
        key,
        navId: msgId,
        blockId,
        icon: entry.icon,
        color: errorColor ?? entry.color,
      };
    }
  }
}

function NavDot({
  Icon,
  color,
  isSelected,
  isScrollActive,
  isMultiSelected,
  dataNavKey,
  dataMessageId,
  dataBlockId,
  avatar,
  agentFilePath,
  agentColor,
  onClick,
  onContextMenu,
}: {
  Icon: LucideIcon;
  color: string;
  isSelected: boolean;
  isScrollActive: boolean;
  isMultiSelected: boolean;
  dataNavKey?: string;
  dataMessageId: string;
  dataBlockId?: string;
  avatar?: AgentAvatarValue;
  agentFilePath?: string;
  agentColor?: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const selectedTone = getSelectedTone(color);
  let bg = "hover:bg-surface-hover ";
  let barBg = "";
  let iconClr = color;
  let iconState = "opacity-75 group-hover:opacity-100";

  if (isMultiSelected) {
    bg = "bg-status-error/25 ";
    barBg = "bg-status-error opacity-100 ";
    iconClr = "text-status-error";
    iconState = "opacity-100";
  } else if (isSelected) {
    bg = "bg-surface-hover/70 ring-1 ring-inset ring-border-secondary/45 ";
    barBg = selectedTone.bar;
    iconClr = color;
    iconState = "opacity-100";
  } else if (isScrollActive) {
    barBg = selectedTone.scrollBar;
    iconState = "opacity-100";
  }

  return (
    <div
      className={`group relative w-10 h-8 rounded-r flex items-center justify-center leading-none cursor-pointer transition-[background-color,box-shadow,transform,opacity] duration-150 ease-out ${isSelected || isScrollActive ? "scale-105" : "scale-100"} ${bg}`}
      style={{ scrollSnapAlign: "start" }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      data-nav-key={dataNavKey}
      data-nav-message-id={dataMessageId}
      data-nav-block-id={dataBlockId}
      data-nav-kind={dataBlockId ? "block" : "message"}
      data-active={isSelected || undefined}
      data-scroll-active={isScrollActive || undefined}
    >
      <span
        className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-full transition-[opacity,background-color,transform] duration-150 ease-out opacity-0 ${isSelected || isScrollActive ? "scale-y-100" : "scale-y-75"} ${barBg}`}
      />
      <AgentAvatar
        avatar={avatar}
        agentFilePath={agentFilePath}
        color={agentColor}
        fallbackIcon={Icon}
        className={`w-4 h-4 shrink-0 ${iconClr} ${iconState} transition-[color,transform,opacity] duration-150 ease-out ${
          isSelected || isScrollActive ? "scale-110" : "scale-100"
        }`}
      />
    </div>
  );
}

function getSelectedTone(color: string): { bar: string; scrollBar: string } {
  switch (color) {
    case "text-status-success":
      return {
        bar: "bg-status-success opacity-100 ",
        scrollBar: "bg-status-success/60 opacity-100 ",
      };
    case "text-status-error":
      return {
        bar: "bg-status-error opacity-100 ",
        scrollBar: "bg-status-error/60 opacity-100 ",
      };
    case "text-status-warning":
      return {
        bar: "bg-status-warning opacity-100 ",
        scrollBar: "bg-status-warning/60 opacity-100 ",
      };
    case "text-status-info":
      return {
        bar: "bg-status-info opacity-100 ",
        scrollBar: "bg-status-info/60 opacity-100 ",
      };
    case "text-semantic-agent":
      return {
        bar: "bg-semantic-agent opacity-100 ",
        scrollBar: "bg-semantic-agent/60 opacity-100 ",
      };
    case "text-semantic-tool":
      return {
        bar: "bg-semantic-tool opacity-100 ",
        scrollBar: "bg-semantic-tool/60 opacity-100 ",
      };
    case "text-semantic-memory":
      return {
        bar: "bg-semantic-memory opacity-100 ",
        scrollBar: "bg-semantic-memory/60 opacity-100 ",
      };
    case "text-semantic-notify":
      return {
        bar: "bg-semantic-notify opacity-100 ",
        scrollBar: "bg-semantic-notify/60 opacity-100 ",
      };
    case "text-pink-400":
      return {
        bar: "bg-pink-400 opacity-100 ",
        scrollBar: "bg-pink-400/60 opacity-100 ",
      };
    case "text-semantic-accent":
      return {
        bar: "bg-semantic-accent opacity-100 ",
        scrollBar: "bg-semantic-accent/60 opacity-100 ",
      };
    default:
      return {
        bar: "bg-text-tertiary/70 opacity-100 ",
        scrollBar: "bg-text-tertiary/50 opacity-100 ",
      };
  }
}

export const SideNav = memo(
  forwardRef<
    { getFirstIconId: () => string | null; getLastIconId: () => string | null },
    {
      messages: ChatMessage[];
      onNavDotClick: (target: SideNavTarget) => void;
      pagination?: SideNavPagination;
      isScrollLocked?: boolean;
    }
  >(function SideNavInner({ messages, onNavDotClick, pagination, isScrollLocked = false }, ref) {
    const sessionId = useSessionStore((s) => s.activeSessionId);
    const activeId = useChatNavStore(
      useCallback(
        (s) => (sessionId ? (s.activeIdBySession[sessionId] ?? null) : null),
        [sessionId],
      ),
    );

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
    const currentAgentName = useAgentStore(
      useCallback(
        (s) => (sessionId ? (s.currentAgentBySession[sessionId] ?? "build") : "build"),
        [sessionId],
      ),
    );
    const currentAgentDetail = useAgentStore(
      useCallback(
        (s) => (sessionId ? (s.agentDetailBySession[sessionId] ?? null) : null),
        [sessionId],
      ),
    );
    const currentAgentSummary = useAgentStore(
      useCallback(
        (s) => s.agents.find((agent) => agent.name === currentAgentName) ?? null,
        [currentAgentName],
      ),
    );

    const showThinking = useSettingsStore((s) => s.showThinking);
    const showMemoryEntries = useSettingsStore((s) => s.showMemoryEntries);
    const showToolCalls = useSettingsStore((s) => s.showToolCalls);
    const showToolResults = useSettingsStore((s) => s.showToolResults);
    const collapsedMessageIds = useTurnStore(
      useCallback(
        (s) => (sessionId ? (s.collapsedMessageIdsBySession[sessionId] ?? EMPTY_SET) : EMPTY_SET),
        [sessionId],
      ),
    );
    const currentAgentAvatar = currentAgentDetail?.avatar ?? currentAgentSummary?.avatar;
    const currentAgentFilePath = currentAgentDetail?.filePath ?? currentAgentSummary?.filePath;
    const currentAgentColor = currentAgentDetail?.color ?? currentAgentSummary?.color;

    const items = useMemo(() => {
      if (!sessionId)
        return buildFlatItems(messages, showThinking, showMemoryEntries, collapsedMessageIds);
      const cached = _flatItemsCache.get(sessionId);
      if (
        cached &&
        cached.version === FLAT_ITEMS_CACHE_VERSION &&
        cached.ref === messages &&
        cached.showThinking === showThinking &&
        cached.showMemoryEntries === showMemoryEntries &&
        cached.showToolCalls === showToolCalls &&
        cached.showToolResults === showToolResults &&
        cached.collapsedMessageIds === collapsedMessageIds
      ) {
        renderLog.info("cache HIT (flatItems)", { sessionId, count: messages.length });
        return cached.result;
      }
      const result = buildFlatItems(
        messages,
        showThinking,
        showMemoryEntries,
        collapsedMessageIds,
        showToolCalls,
        showToolResults,
      );
      renderLog.info("cache MISS (flatItems)", {
        sessionId,
        count: messages.length,
        computeCount: result.length,
      });
      _flatItemsCache.set(sessionId, {
        version: FLAT_ITEMS_CACHE_VERSION,
        ref: messages,
        showThinking,
        showMemoryEntries,
        showToolCalls,
        showToolResults,
        collapsedMessageIds,
        result,
      });
      evictFlatItemsIfNeeded();
      return result;
    }, [
      messages,
      showThinking,
      showMemoryEntries,
      showToolCalls,
      showToolResults,
      collapsedMessageIds,
      sessionId,
    ]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const viewportShellRef = useRef<HTMLDivElement>(null);
    const firstNavRef = useRef(true);
    const loadMoreRafRef = useRef<number | null>(null);
    const [viewportMetrics, setViewportMetrics] = useState<SideNavViewportMetrics>({
      gap: 0,
      viewportHeight: 0,
      visibleItemCount: 0,
    });
    const [visibleEdgeFallbackKey, setVisibleEdgeFallbackKey] = useState<string | null>(null);
    const clickSuppressRef = useRef<{
      key: string;
      navId: string;
      blockId?: string;
      until: number;
    } | null>(null);

    const refreshVisibleEdgeFallback = useCallback(() => {
      const container = scrollRef.current;
      if (!container) {
        setVisibleEdgeFallbackKey(null);
        return;
      }
      setVisibleEdgeFallbackKey(getSideNavVisibleEdgeFallbackKey(container, activeId));
    }, [activeId]);

    // 切换会话时重置首次标记
    useEffect(() => {
      firstNavRef.current = true;
    }, [sessionId]);

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
        clickSuppressRef.current = {
          key,
          navId,
          blockId,
          until: Date.now() + SIDE_NAV_CLICK_SCROLL_SUPPRESS_MS,
        };
        setNavId(key);
        onNavDotClick({ messageId: navId, blockId });
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
      const container = scrollRef.current;
      if (!container || !pagination) return;

      const onScroll = () => {
        if (loadMoreRafRef.current != null) return;
        loadMoreRafRef.current = requestAnimationFrame(() => {
          loadMoreRafRef.current = null;
          if (container.scrollTop < 30 && pagination.hasMore && !pagination.isLoading) {
            pagination.onLoadMore();
          }
        });
      };

      container.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        container.removeEventListener("scroll", onScroll);
        if (loadMoreRafRef.current != null) {
          cancelAnimationFrame(loadMoreRafRef.current);
          loadMoreRafRef.current = null;
        }
      };
    }, [pagination]);

    useEffect(() => {
      const container = scrollRef.current;
      if (!container) return;

      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          refreshVisibleEdgeFallback();
        });
      };

      container.addEventListener("scroll", onScroll, { passive: true });
      refreshVisibleEdgeFallback();
      return () => {
        container.removeEventListener("scroll", onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    }, [refreshVisibleEdgeFallback, items, viewportMetrics.viewportHeight]);

    useLayoutEffect(() => {
      refreshVisibleEdgeFallback();
      let secondRaf = 0;
      const raf = requestAnimationFrame(() => {
        refreshVisibleEdgeFallback();
        secondRaf = requestAnimationFrame(refreshVisibleEdgeFallback);
      });
      return () => {
        cancelAnimationFrame(raf);
        if (secondRaf) cancelAnimationFrame(secondRaf);
      };
    }, [refreshVisibleEdgeFallback, items, viewportMetrics.viewportHeight]);

    useEffect(() => {
      const shell = viewportShellRef.current;
      if (!shell) return;

      const updateMetrics = () => {
        const visualHeight = shell.getBoundingClientRect().height || shell.clientHeight;
        const next = getSideNavViewportMetrics(visualHeight, items.length);
        setViewportMetrics((current) =>
          current.gap === next.gap &&
          current.viewportHeight === next.viewportHeight &&
          current.visibleItemCount === next.visibleItemCount
            ? current
            : next,
        );
      };

      updateMetrics();
      if (typeof ResizeObserver === "undefined") return;

      const observer = new ResizeObserver(updateMetrics);
      observer.observe(shell);
      return () => observer.disconnect();
    }, [items.length]);

    useEffect(() => {
      if (!selectedNavId) return;
      const container = scrollRef.current;
      if (!container) return;
      if (isScrollLocked) return;
      const suppressed = clickSuppressRef.current;
      if (suppressed && Date.now() < suppressed.until) return;

      const activeEl = container.querySelector("[data-active]");
      if (activeEl) {
        const isFirst = firstNavRef.current;
        firstNavRef.current = false;
        scrollSideNavItemIntoView(container, activeEl as HTMLElement, isFirst ? "auto" : "smooth");
      }
    }, [selectedNavId, sessionId, items, isScrollLocked]);

    useEffect(() => {
      if (!activeId) return;
      const container = scrollRef.current;
      if (!container) return;
      if (isScrollLocked) return;
      const suppressed = clickSuppressRef.current;
      if (suppressed && Date.now() < suppressed.until) return;
      const isInitialSync = firstNavRef.current;

      const syncActiveIntoView = () => {
        const activeEl = findSideNavItemByKey(container, activeId);
        if (!activeEl) return;
        firstNavRef.current = false;
        scrollSideNavItemIntoView(container, activeEl, "auto", "edge", SIDE_NAV_FOLLOW_MARGIN);
        requestAnimationFrame(refreshVisibleEdgeFallback);
      };

      syncActiveIntoView();
      const raf = requestAnimationFrame(syncActiveIntoView);
      const settleDelays = isInitialSync
        ? SIDE_NAV_INITIAL_ACTIVE_SETTLE_DELAYS_MS
        : SIDE_NAV_ACTIVE_SETTLE_DELAYS_MS;
      const timers = settleDelays.map((delay) => window.setTimeout(syncActiveIntoView, delay));
      return () => {
        cancelAnimationFrame(raf);
        timers.forEach((timer) => window.clearTimeout(timer));
      };
    }, [
      activeId,
      sessionId,
      items,
      isScrollLocked,
      viewportMetrics.viewportHeight,
      refreshVisibleEdgeFallback,
    ]);

    return (
      <div className="h-full min-h-0 flex flex-col bg-surface-dim/30 dark:bg-surface-code/30 border-l border-border-secondary/30 overflow-hidden">
        <div ref={viewportShellRef} className="flex-1 min-h-0">
          <div
            ref={scrollRef}
            className="overflow-y-auto overflow-x-hidden"
            style={{
              height: "100%",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              scrollSnapType: "y proximity",
            }}
          >
            <div
              style={{
                minHeight: "100%",
                display: "flex",
                flexDirection: "column",
                gap: viewportMetrics.gap || undefined,
              }}
            >
              {items.map((item, i) => {
                const selected = selectedNavId === item.key;
                const isFirstForMessage = !items[i - 1] || items[i - 1].navId !== item.navId;
                const rawScrollActive =
                  activeId === item.key || (activeId === item.navId && isFirstForMessage);
                const scrollActive = visibleEdgeFallbackKey
                  ? visibleEdgeFallbackKey === item.key
                  : rawScrollActive;
                const multi = selectedItems.has(item.navId);
                return (
                  <NavDot
                    key={item.key}
                    dataNavKey={item.key}
                    dataMessageId={item.navId}
                    dataBlockId={item.blockId}
                    Icon={item.icon}
                    color={item.color}
                    isSelected={selected}
                    isScrollActive={scrollActive}
                    isMultiSelected={multi}
                    avatar={item.useAgentAvatar ? currentAgentAvatar : undefined}
                    agentFilePath={item.useAgentAvatar ? currentAgentFilePath : undefined}
                    agentColor={item.useAgentAvatar ? currentAgentColor : undefined}
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
