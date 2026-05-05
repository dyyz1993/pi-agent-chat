import { Zap, Clock, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";

export function QueueCards({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation("chat");
  const queue = useSessionStore((s) => s.queueBySession[sessionId]);
  const clearQueue = useChatStore((s) => s.clearQueue);

  if (!queue || (queue.steering.length === 0 && queue.followUp.length === 0)) return null;

  const total = queue.steering.length + queue.followUp.length;

  return (
    <div className="px-4 py-2 flex-shrink-0">
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-800/60 border border-gray-700/50">
        <div className="flex-1 min-w-0 space-y-1">
          {queue.steering.map((text, i) => (
            <div key={`s-${i}`} className="flex items-center gap-1.5 text-xs text-amber-400/90">
              <Zap className="w-3 h-3 shrink-0" />
              <span className="truncate">{text}</span>
            </div>
          ))}
          {queue.followUp.map((text, i) => (
            <div key={`f-${i}`} className="flex items-center gap-1.5 text-xs text-blue-400/90">
              <Clock className="w-3 h-3 shrink-0" />
              <span className="truncate">{text}</span>
            </div>
          ))}
        </div>
        <button
          onClick={clearQueue}
          className="shrink-0 p-1 rounded hover:bg-gray-700/60 text-gray-500 hover:text-gray-300 transition-colors"
          title={t("revokeQueuedMessages", { count: total })}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
