import { useMemo } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MessageCard } from "./MessageCard";
import type { ChatMessage } from "../../types";
import { ALL_MEMORY_TYPE_KEYS } from "./memory-config";

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
  messages: ChatMessage[];
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  virtualizer?: Virtualizer<HTMLDivElement, Element>;
  isLoadingMore?: boolean;
  hasMoreMessages?: boolean;
}

export function MessageListView({
  messages,
  scrollRef,
  onScroll,
  virtualizer,
  isLoadingMore,
  hasMoreMessages,
}: MessageListViewProps) {
  const { t } = useTranslation("chat");
  const cardMeta = useMemo(() => buildCardMeta(messages, t), [messages, t]);

  if (messages.length === 0 && scrollRef) {
    return (
      <div
        ref={scrollRef as React.Ref<HTMLDivElement>}
        className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
        style={{ overflowAnchor: "none" }}
        onScroll={onScroll}
      >
        <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-2">
          <p>{t("startConversation")}</p>
        </div>
      </div>
    );
  }

  if (virtualizer) {
    return (
      <div
        ref={(el) => {
          if (scrollRef) (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
        style={{ overflowAnchor: "none" }}
        onScroll={onScroll}
      >
        {(isLoadingMore ?? hasMoreMessages) && (
          <div className="flex items-center justify-center py-2">
            {isLoadingMore ? (
              <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
            ) : hasMoreMessages ? (
              <span className="text-[10px] text-gray-600">{t("scrollUpToLoadMore")}</span>
            ) : null}
          </div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((vr) => {
            const msg = messages[vr.index];
            const meta = cardMeta.get(msg.id);
            return (
              <div
                key={msg.id}
                data-index={vr.index}
                data-msg-id={msg.id}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vr.start}px)`,
                }}
              >
                <MessageCard
                  message={msg}
                  cardLabel={meta?.cardLabel}
                  prevBarColor={meta?.prevBarColor}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef as React.Ref<HTMLDivElement>}
      className="flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain"
      style={{
        scrollbarWidth: "thin",
        scrollbarColor: "transparent transparent",
        overflowAnchor: "none",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.scrollbarColor =
          "rgba(55, 65, 81, 0.12) transparent";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.scrollbarColor = "transparent transparent";
      }}
      onScroll={onScroll}
    >
      <div className="py-0.5 pl-2 pr-3">
        {messages.map((msg) => {
          const meta = cardMeta.get(msg.id);
          return (
            <MessageCard
              key={msg.id}
              message={msg}
              cardLabel={meta?.cardLabel}
              prevBarColor={meta?.prevBarColor}
            />
          );
        })}
      </div>
    </div>
  );
}
