import { useMemo, memo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import { MessageCard } from "./MessageCard";
import type { ChatMessage } from "../../types";
import { ALL_MEMORY_TYPE_KEYS } from "./memory-config";
import { useChatStore } from "../../stores/use-chat-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSettingsStore } from "../../stores/use-settings-store";

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
  const last = messages[n - 1];
  const blocks = last.content;
  if (blocks.length === 0) return `${n}:${last.id}:0`;
  let totalSize = 0;
  for (const block of blocks) {
    if (block.type === "text") totalSize += block.text.length;
    else if (block.type === "thinking") totalSize += block.thinking.length;
    else if (block.type === "toolExecution") totalSize += (block.output ?? "").length;
  }
  return `${n}:${last.id}:${blocks.length}:${totalSize}`;
}

const _processedMessagesCache = new Map<string, CacheEntry<ProcessedMessage[]>>();

interface CardMetaEntry {
  cardLabel: string | undefined;
  prevBarColor: string | undefined;
}

const _cardMetaCache = new Map<string, CacheEntry<Map<string, CardMetaEntry>>>();

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

export function buildProcessedMessages(
  messages: ChatMessage[],
  showMemoryEntries: boolean,
): ProcessedMessage[] {
  const result: ProcessedMessage[] = [];

  for (const msg of messages) {
    const customBlock = msg.content.find(
      (b): b is Extract<(typeof msg)["content"][number], { type: "custom" }> => b.type === "custom",
    );
    if (customBlock && ALL_MEMORY_TYPE_KEYS.has(customBlock.customType) && !showMemoryEntries) {
      continue;
    }

    result.push({ msg });
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
}: MessageListViewProps) {
  const messages = useStableMessages(source);
  const { t } = useTranslation("chat");
  const showMemoryEntries = useSettingsStore((s) => s.showMemoryEntries);
  const cardMeta = useMemo(() => {
    if (!activeSessionId) return buildCardMeta(messages, t);
    const revision = computeMessagesRevision(messages);
    const cached = _cardMetaCache.get(activeSessionId);
    if (cached && cached.revision === revision) {
      return cached.result;
    }
    const result = buildCardMeta(messages, t);
    _cardMetaCache.set(activeSessionId, { revision, result });
    evictIfNeeded(_cardMetaCache);
    return result;
  }, [messages, t, activeSessionId]);
  const processedMessages = useMemo(() => {
    if (!activeSessionId) return buildProcessedMessages(messages, showMemoryEntries);
    const revision = computeMessagesRevision(messages);
    const cached = _processedMessagesCache.get(activeSessionId);
    if (cached && cached.revision === revision) {
      return cached.result;
    }
    const result = buildProcessedMessages(messages, showMemoryEntries);
    _processedMessagesCache.set(activeSessionId, { revision, result });
    evictIfNeeded(_processedMessagesCache);
    return result;
  }, [messages, activeSessionId, showMemoryEntries]);

  if (messages.length === 0 && scrollRef) {
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
        bufferSize={800}
        onScroll={() => onScroll?.()}
        onScrollEnd={() => onScrollEnd?.()}
      >
        {processedMessages.map((item) => {
          if (item.hide) return <div key={item.msg.id} style={{ height: 0 }} />;
          const meta = cardMeta.get(item.msg.id);
          return (
            <div key={item.msg.id} data-msg-id={item.msg.id} className="py-0.5 pl-1 pr-1.5">
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
