import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, SendHorizontal, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type QueueItemRef, useSessionQueueStore } from "../../stores/use-session-queue-store";
import { useChatStore } from "../../stores/use-chat-store";

export function QueueCards({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation("chat");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const queue = useSessionQueueStore((s) => s.queueBySession[sessionId]);
  const clearQueue = useChatStore((s) => s.clearQueue);
  const clearQueuedMessage = useChatStore((s) => s.clearQueuedMessage);
  const promoteQueuedFollowUp = useChatStore((s) => s.promoteQueuedFollowUp);

  if (!queue || (queue.steering.length === 0 && queue.followUp.length === 0)) return null;

  const total = queue.steering.length + queue.followUp.length;
  const toggleExpanded = (key: string) => {
    setExpandedItems((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const renderItem = (item: QueueItemRef) => {
    const key = `${item.type}-${item.index}`;
    const isExpanded = expandedItems.has(key);
    const isSteering = item.type === "steering";
    const Icon = isSteering ? Zap : Clock;
    const label = isSteering ? t("queuedSteeringLabel") : t("queuedFollowUpLabel");
    const preview = item.text.split(/\r?\n/, 1)[0] || item.text;
    const colorClass = isSteering
      ? "text-amber-600 dark:text-amber-400/90"
      : "text-blue-600 dark:text-blue-400/90";

    return (
      <div key={key} className={`rounded-md ${isExpanded ? "bg-surface-hover/40" : ""}`}>
        <div className={`flex items-center gap-1.5 text-xs ${colorClass}`}>
          <Icon className="w-3 h-3 shrink-0" />
          <button
            type="button"
            onClick={() => toggleExpanded(key)}
            className="min-w-0 flex-1 flex items-center gap-1 text-left rounded px-1 py-0.5 hover:bg-surface-hover transition-colors"
            aria-label={t(isExpanded ? "collapseQueuedMessage" : "expandQueuedMessage", {
              text: preview,
            })}
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 shrink-0 text-text-tertiary" />
            ) : (
              <ChevronRight className="w-3 h-3 shrink-0 text-text-tertiary" />
            )}
            <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-80">{label}</span>
            <span className="truncate">{preview}</span>
          </button>
          {item.type === "followUp" ? (
            <button
              type="button"
              onClick={() => {
                void promoteQueuedFollowUp({
                  type: "followUp",
                  index: item.index,
                  text: item.text,
                });
              }}
              className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
              title={t("sendQueuedMessageNow", { text: preview })}
              aria-label={t("sendQueuedMessageNow", { text: preview })}
            >
              <SendHorizontal className="w-3 h-3" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void clearQueuedMessage(item);
            }}
            className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
            title={t("revokeQueuedMessage", { text: preview })}
            aria-label={t("revokeQueuedMessage", { text: preview })}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {isExpanded ? (
          <pre className="mt-1 ml-4 whitespace-pre-wrap break-words rounded bg-surface-elevated px-2 py-1 text-xs text-text-secondary">
            {item.text}
          </pre>
        ) : null}
      </div>
    );
  };

  return (
    <div className="px-3 py-1.5 flex-shrink-0">
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-surface-dim border border-border-secondary">
        <div className="flex-1 min-w-0 space-y-1">
          {queue.steering.map((text, index) => renderItem({ type: "steering", index, text }))}
          {queue.followUp.map((text, index) => renderItem({ type: "followUp", index, text }))}
        </div>
        <button
          type="button"
          onClick={clearQueue}
          className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-tertiary hover:text-text-primary transition-colors"
          title={t("revokeQueuedMessages", { count: total })}
          aria-label={t("revokeQueuedMessages", { count: total })}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
