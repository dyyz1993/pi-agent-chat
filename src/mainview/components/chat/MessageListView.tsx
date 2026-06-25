import { useMemo, memo, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import { MessageCard } from "./MessageCard";
import type { ChatMessage } from "../../types";
import { ALL_MEMORY_TYPE_KEYS } from "./memory-config";
import { MEMORY_HIDDEN_IN_CHAT, isLspCustomType, isLspVisibleInChat } from "./lsp-constants";
import { MEMORY_CUSTOM_TYPES } from "./MemoryCard";
import { isBashBackgroundProcessType } from "./bash-background-process";
import { CHAT_LIST_ITEM_CLASS } from "./chat-layout-classes";
import { dedupeMemoryInjectMessages, useChatStore } from "../../stores/use-chat-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSettingsStore } from "../../stores/use-settings-store";
import type { CompactionActivity } from "../../stores/use-compaction-store";
import { useCompactionStore } from "../../stores/use-compaction-store";

const EMPTY_MSGS: ChatMessage[] = [];

const MAX_CACHE_SIZE = 10;

interface CacheEntry<T> {
  revision: string;
  result: T;
}

/**
 * Lightweight structural revision key for message arrays.
 * Captures message count + last message id/content-length to detect
 * changes that would affect cardMeta/processedMessages caches.
 *
 * IMPORTANT: sums ALL blocks' content sizes, not just the last block.
 * During parallel tool execution, multiple blocks grow simultaneously
 * (e.g. two bash commands streaming output). If we only checked the
 * last block, updates to earlier blocks would be invisible (cache hit
 * with stale data → "waiting" shown forever).
 */
export function computeMessagesRevision(messages: ChatMessage[]): string {
  const n = messages.length;
  if (n === 0) return "0";
  let streamingCount = 0;
  const last = messages[n - 1];
  const blocks = last.content;
  let totalSize = 0;
  for (let i = 0; i < n; i++) {
    if (messages[i].isStreaming) streamingCount++;
  }
  if (blocks.length === 0) return `${n}:${last.id}:0:${streamingCount}`;
  for (const block of blocks) {
    if (block.type === "text") totalSize += block.text.length;
    else if (block.type === "thinking") totalSize += block.thinking.length;
    else if (block.type === "toolExecution") totalSize += (block.output ?? "").length;
  }
  return `${n}:${last.id}:${blocks.length}:${totalSize}:${streamingCount}`;
}

const _processedMessagesCache = new Map<string, CacheEntry<ProcessedMessage[]>>();

interface CardMetaEntry {
  cardLabel: string | undefined;
  prevBarColor: string | undefined;
}

const _cardMetaCache = new Map<string, CacheEntry<Map<string, CardMetaEntry>>>();
const MESSAGE_LIST_PROCESSING_VERSION = 3;

function buildCompactionActivityMessage(
  sessionId: string,
  activity: CompactionActivity,
): ChatMessage {
  return {
    id: `__compaction_running__:${sessionId}`,
    role: "compactionSummary",
    content: [
      {
        type: "compactionSummary",
        summary: "",
        status: activity.status,
        reason: activity.reason,
        startedAt: activity.startedAt,
      },
    ],
    timestamp: 0,
    isStreaming: activity.status === "running",
    _local: true,
  };
}

function evictIfNeeded<K, V>(cache: Map<K, V>): void {
  if (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

/**
 * Stable selector: only returns a new reference when message count or
 * last message id actually changes. This prevents unnecessary re-renders
 * when the array is replaced with identical content.
 */
function useStableMessages(source: "main" | "sub"): ChatMessage[] {
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);

  const selector = useCallback(
    (s: { messagesBySession: Record<string, ChatMessage[]> }) => {
      if (!sessionId) return EMPTY_MSGS;
      return s.messagesBySession[sessionId] || EMPTY_MSGS;
    },
    [sessionId],
  );

  const subSelector = useCallback(
    (s: { messagesBySubsession: Record<string, ChatMessage[]> }) => {
      if (!activeSubId) return EMPTY_MSGS;
      return s.messagesBySubsession[activeSubId] || EMPTY_MSGS;
    },
    [activeSubId],
  );

  return source === "sub" ? useSubagentStore(subSelector) : useChatStore(selector);
}

interface ProcessedMessage {
  msg: ChatMessage;
  mergedResultData?: unknown;
  hide?: boolean;
}

function isMemoryOnlyCustomMessage(msg: ChatMessage): boolean {
  if (msg.role !== "custom") return false;
  return (
    msg.content.length > 0 &&
    msg.content.every((block) => {
      return block.type === "custom" && ALL_MEMORY_TYPE_KEYS.has(block.customType);
    })
  );
}

export function buildProcessedMessages(
  messages: ChatMessage[],
  showMemoryEntries: boolean,
  options: { hideLeadingOrphanMemoryEntries?: boolean } = {},
): ProcessedMessage[] {
  const result: ProcessedMessage[] = [];
  let hasConversationAnchor = false;

  for (const msg of dedupeMemoryInjectMessages(messages)) {
    const isConversationAnchor = msg.role === "user" || msg.role === "assistant";
    if (
      options.hideLeadingOrphanMemoryEntries === true &&
      !hasConversationAnchor &&
      isMemoryOnlyCustomMessage(msg)
    ) {
      continue;
    }

    const customBlock = msg.content.find(
      (b): b is Extract<(typeof msg)["content"][number], { type: "custom" }> => b.type === "custom",
    );
    if (customBlock && ALL_MEMORY_TYPE_KEYS.has(customBlock.customType) && !showMemoryEntries) {
      continue;
    }

    // Skip custom messages where ALL blocks would be hidden by MessageCard,
    // so we don't render an empty wrapper div in the DOM.
    if (msg.content.some((b) => b.type === "custom")) {
      const allHidden = msg.content.every((b) => {
        if (b.type !== "custom") return false;
        if (MEMORY_HIDDEN_IN_CHAT.has(b.customType)) return true;
        if (isLspCustomType(b.customType) && !isLspVisibleInChat(b.customType)) return true;
        if (
          !MEMORY_CUSTOM_TYPES.has(b.customType) &&
          !isLspCustomType(b.customType) &&
          !isBashBackgroundProcessType(b.customType) &&
          b.customType !== "step_snapshot" &&
          b.customType !== "supervisor_goal_complete"
        )
          return true;
        return false;
      });
      if (allHidden) continue;
    }

    result.push({ msg });
    if (isConversationAnchor) {
      hasConversationAnchor = true;
    }
  }

  return result;
}

function getCardLabel(msg: ChatMessage, t: (key: string) => string): string | undefined {
  const hasCustom = msg.content.some((b) => b.type === "custom");
  if (hasCustom) {
    const custom = msg.content.find(
      (b): b is Extract<typeof b, { type: "custom" }> => b.type === "custom",
    );
    if (!custom) return undefined;
    switch (custom.customType) {
      case "bash_background_process":
      case "bash_background_exit":
        return t("sideNav.backgroundProcess");
      case "lsp_diagnostics":
        return "LSP";
      default:
        if (ALL_MEMORY_TYPE_KEYS.has(custom.customType)) return undefined;
        return custom.customType;
    }
  }
  if (msg.role === "user") return t("messageCard.you");
  return t("messageCard.assistant");
}

function getPrevBarColor(messages: ChatMessage[], index: number): string | undefined {
  if (index <= 0) return undefined;
  const prev = messages[index - 1];
  const prevHasCustom = prev.content.some((b) => b.type === "custom");
  if (prevHasCustom) return "border-l-yellow-500/50";
  if (prev.role === "user") return "border-l-blue-500/60";
  return "border-l-emerald-500/50";
}

function buildCardMeta(
  messages: ChatMessage[],
  t: (key: string) => string,
): Map<string, { cardLabel: string | undefined; prevBarColor: string | undefined }> {
  const map = new Map<
    string,
    { cardLabel: string | undefined; prevBarColor: string | undefined }
  >();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    map.set(msg.id, {
      cardLabel: getCardLabel(msg, t),
      prevBarColor: getPrevBarColor(messages, i),
    });
  }
  return map;
}

interface MessageListViewProps {
  /** Which message source to read from store */
  source: "main" | "sub";
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  vlistRef?: React.RefObject<VirtualizerHandle> | React.Ref<VirtualizerHandle>;
  onScroll?: () => void;
  onScrollEnd?: () => void;
  isLoadingMore?: boolean;
  hasMoreMessages?: boolean;
  activeSessionId?: string;
  bufferSize?: number;
}

export const MessageListView = memo(function MessageListView({
  source,
  scrollRef,
  vlistRef,
  onScroll,
  onScrollEnd,
  isLoadingMore,
  hasMoreMessages,
  activeSessionId,
  bufferSize = 800,
}: MessageListViewProps) {
  const messages = useStableMessages(source);
  const { t } = useTranslation("chat");
  const showMemoryEntries = useSettingsStore((s) => s.showMemoryEntries);
  const sessionStatus = useSessionStore(
    useCallback(
      (s) => (activeSessionId ? s.sessionStatusMap[activeSessionId] : undefined),
      [activeSessionId],
    ),
  );
  const compactionActivity = useCompactionStore(
    useCallback(
      (s) => (activeSessionId ? s.activitiesBySession[activeSessionId] : undefined),
      [activeSessionId],
    ),
  );
  useEffect(() => {
    if (
      source === "main" &&
      activeSessionId &&
      sessionStatus === "compacting" &&
      !compactionActivity
    ) {
      useCompactionStore.getState().markRunning(activeSessionId, "active");
    }
  }, [activeSessionId, compactionActivity, sessionStatus, source]);
  const visibleMessages = useMemo(() => {
    if (source !== "main" || !activeSessionId) {
      return messages;
    }
    const activity = compactionActivity;
    if (!activity || activity.status === "completed") return messages;
    if (messages.some((msg) => msg.id === `__compaction_running__:${activeSessionId}`)) {
      return messages;
    }
    return [...messages, buildCompactionActivityMessage(activeSessionId, activity)];
  }, [activeSessionId, compactionActivity, messages, sessionStatus, source]);

  useEffect(() => {
    if (source !== "main" || compactionActivity?.status !== "running") return;
    const scrollEl = scrollRef?.current;
    if (!scrollEl) return;
    const frame = requestAnimationFrame(() => {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [compactionActivity?.startedAt, compactionActivity?.status, scrollRef, source]);

  const messagesRevision = useMemo(
    () => computeMessagesRevision(visibleMessages),
    [visibleMessages],
  );

  const cardMeta = useMemo(() => {
    if (!activeSessionId) return buildCardMeta(visibleMessages, t);
    const revision = `${messagesRevision}:v:${MESSAGE_LIST_PROCESSING_VERSION}:status:${sessionStatus ?? ""}`;
    const cached = _cardMetaCache.get(activeSessionId);
    if (cached && cached.revision === revision) {
      return cached.result;
    }
    const result = buildCardMeta(visibleMessages, t);
    _cardMetaCache.set(activeSessionId, { revision, result });
    evictIfNeeded(_cardMetaCache);
    return result;
  }, [visibleMessages, t, activeSessionId, sessionStatus, messagesRevision]);
  const processedMessages = useMemo(() => {
    const hideLeadingOrphanMemoryEntries =
      source === "main" && [isLoadingMore, hasMoreMessages].some((value) => value === true);
    if (!activeSessionId) {
      return buildProcessedMessages(visibleMessages, showMemoryEntries, {
        hideLeadingOrphanMemoryEntries,
      });
    }
    const revision = `${messagesRevision}:v:${MESSAGE_LIST_PROCESSING_VERSION}:memory:${showMemoryEntries ? "1" : "0"}:hide-orphan-memory:${hideLeadingOrphanMemoryEntries ? "1" : "0"}:status:${sessionStatus ?? ""}`;
    const cached = _processedMessagesCache.get(activeSessionId);
    if (cached && cached.revision === revision) {
      return cached.result;
    }
    const result = buildProcessedMessages(visibleMessages, showMemoryEntries, {
      hideLeadingOrphanMemoryEntries,
    });
    _processedMessagesCache.set(activeSessionId, { revision, result });
    evictIfNeeded(_processedMessagesCache);
    return result;
  }, [
    activeSessionId,
    hasMoreMessages,
    isLoadingMore,
    messagesRevision,
    sessionStatus,
    showMemoryEntries,
    source,
    visibleMessages,
  ]);

  if (visibleMessages.length === 0 && scrollRef) {
    return (
      <div
        ref={scrollRef as React.Ref<HTMLDivElement>}
        className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div className="flex flex-col items-center justify-center h-full text-text-secondary text-sm gap-2">
          <p>{t("startConversation")}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
      style={{
        scrollbarWidth: "thin",
        scrollbarColor: "transparent transparent",
        overflowAnchor: "none",
        willChange: undefined,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.scrollbarColor =
          "color-mix(in srgb, var(--color-text-tertiary) 28%, transparent) transparent";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.scrollbarColor = "transparent transparent";
      }}
    >
      {(isLoadingMore ?? hasMoreMessages) && (
        <div className="flex items-center justify-center py-2">
          {isLoadingMore ? (
            <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" />
          ) : hasMoreMessages ? (
            <span className="text-[10px] text-text-secondary">{t("scrollUpToLoadMore")}</span>
          ) : null}
        </div>
      )}
      <Virtualizer
        ref={vlistRef}
        scrollRef={scrollRef as React.RefObject<HTMLDivElement | null>}
        bufferSize={bufferSize}
        onScroll={() => onScroll?.()}
        onScrollEnd={() => onScrollEnd?.()}
      >
        {processedMessages.map((item) => {
          if (item.hide) return <div key={item.msg.id} style={{ height: 0 }} />;
          const meta = cardMeta.get(item.msg.id);
          return (
            <div key={item.msg.id} data-msg-id={item.msg.id} className={CHAT_LIST_ITEM_CLASS}>
              <MessageCard
                message={item.msg}
                cardLabel={meta?.cardLabel}
                prevBarColor={meta?.prevBarColor}
                mergedResultData={item.mergedResultData}
              />
            </div>
          );
        })}
      </Virtualizer>
    </div>
  );
});
