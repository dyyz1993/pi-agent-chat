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

const EMPTY_MSGS: ChatMessage[] = [];

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

function buildProcessedMessages(messages: ChatMessage[]): ProcessedMessage[] {
  const result: ProcessedMessage[] = [];
  const hideIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (hideIds.has(msg.id)) continue;

    const customBlock = msg.content.find(
      (b): b is Extract<(typeof msg)["content"][number], { type: "custom" }> => b.type === "custom",
    );
    if (customBlock?.customType === "memory_prefetch") {
      if (i + 1 < messages.length) {
        const nextMsg = messages[i + 1];
        const nextBlock = nextMsg.content.find(
          (b): b is Extract<(typeof nextMsg)["content"][number], { type: "custom" }> =>
            b.type === "custom",
        );
        if (nextBlock?.customType === "memory_prefetch_result") {
          result.push({ msg, mergedResultData: nextBlock.data });
          hideIds.add(nextMsg.id);
          continue;
        }
      }
      result.push({ msg });
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
}

export const MessageListView = memo(function MessageListView({
  source,
  scrollRef,
  vlistRef,
  onScroll,
  onScrollEnd,
  isLoadingMore,
  hasMoreMessages,
}: MessageListViewProps) {
  // Read messages directly from store — avoids prop drilling that breaks memo
  const messages = useStableMessages(source);
  const { t } = useTranslation("chat");
  const cardMeta = useMemo(() => buildCardMeta(messages, t), [messages, t]);
  const processedMessages = useMemo(() => buildProcessedMessages(messages), [messages]);

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
        willChange: "scroll-position",
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
