import { useMemo } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { MessageCard } from "./MessageCard";
import type { ChatMessage } from "../../types";

function getCardLabel(msg: ChatMessage): string | undefined {
  const hasCustom = msg.content.some((b) => b.type === "custom");
  if (hasCustom) {
    const custom = msg.content.find((b): b is Extract<typeof b, { type: "custom" }> => b.type === "custom");
    if (!custom) return undefined;
    switch (custom.customType) {
      case "bash_background_exit": return "后台进程";
      case "lsp_diagnostics": return "LSP";
      case "memory_prefetch":
      case "memory_prefetch_result":
      case "memory_extract":
      case "memory_dream":
      case "memory_created":
      case "memory_failed": return undefined;
      default: return custom.customType;
    }
  }
  if (msg.role === "user") return "你";
  return "助手";
}

function getPrevBarColor(messages: ChatMessage[], index: number): string | undefined {
  if (index <= 0) return undefined;
  const prev = messages[index - 1];
  const prevHasCustom = prev.content.some((b) => b.type === "custom");
  if (prevHasCustom) return "border-l-yellow-500/50";
  if (prev.role === "user") return "border-l-blue-500/60";
  return "border-l-emerald-500/50";
}

function buildCardMeta(messages: ChatMessage[]): Map<string, { cardLabel: string | undefined; prevBarColor: string | undefined }> {
  const map = new Map<string, { cardLabel: string | undefined; prevBarColor: string | undefined }>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    map.set(msg.id, { cardLabel: getCardLabel(msg), prevBarColor: getPrevBarColor(messages, i) });
  }
  return map;
}

interface MessageListViewProps {
  messages: ChatMessage[];
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
  virtualizer?: Virtualizer<HTMLDivElement, Element>;
}

export function MessageListView({ messages, scrollRef, onScroll, virtualizer }: MessageListViewProps) {
  const cardMeta = useMemo(() => buildCardMeta(messages), [messages]);

  if (messages.length === 0 && scrollRef) {
    return (
      <div ref={scrollRef as React.Ref<HTMLDivElement>} className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain" style={{ overflowAnchor: 'none' }} onScroll={onScroll}>
        <div className="flex flex-col items-center justify-center h-full text-gray-600 text-sm gap-2">
          <p>开始对话吧</p>
        </div>
      </div>
    );
  }

  if (virtualizer) {
    return (
      <div ref={scrollRef as React.Ref<HTMLDivElement>} className="h-full overflow-y-auto overflow-x-hidden overscroll-y-contain" style={{ overflowAnchor: 'none' }} onScroll={onScroll}>
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
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
              >
                <MessageCard message={msg} cardLabel={meta?.cardLabel} prevBarColor={meta?.prevBarColor} />
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
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'transparent transparent', overflowAnchor: 'none' }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.scrollbarColor = '#37415120 transparent' }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.scrollbarColor = 'transparent transparent' }}
      onScroll={onScroll}
    >
      <div className="py-0.5 pl-2 pr-3">
        {useMemo(() => messages.map((msg) => {
          const meta = cardMeta.get(msg.id);
          return (
            <MessageCard
              key={msg.id}
              message={msg}
              cardLabel={meta?.cardLabel}
              prevBarColor={meta?.prevBarColor}
            />
          );
        }), [messages, cardMeta])}
      </div>
    </div>
  );
}
