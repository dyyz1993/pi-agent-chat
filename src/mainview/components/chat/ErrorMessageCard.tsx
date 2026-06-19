import { memo, useCallback, useState } from "react";
import { AlertTriangle, ChevronDown, Copy, Check } from "lucide-react";
import { useClipboard } from "./preview/use-clipboard";
import type { ChatMessage } from "../../types";
import { CHAT_CARD_SHELL_CLASS } from "./chat-layout-classes";

export const ErrorMessageCard = memo(function ErrorMessageCard({
  message,
  title,
  detail,
  stopReason,
}: {
  message: ChatMessage;
  title: string;
  detail: string;
  stopReason?: string | null;
}) {
  const { copied, copy } = useClipboard(2000);
  const [expanded, setExpanded] = useState(false);
  const hasDetail = detail.length > 0;

  const handleCopy = useCallback(() => {
    const copyText = [title, detail, stopReason ? `stopReason: ${stopReason}` : ""]
      .filter(Boolean)
      .join("\n");
    copy(copyText);
  }, [title, detail, stopReason, copy]);

  return (
    <div data-msg-card-id={message.id} className={CHAT_CARD_SHELL_CLASS}>
      <div className="mx-3 rounded-lg bg-status-error/10 border border-status-error/20">
        <div className="flex items-start gap-2 px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-status-error mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-status-error font-medium">{title}</span>
              {stopReason && (
                <span className="text-[10px] text-status-error/60 bg-status-error/10 px-1.5 py-0.5 rounded">
                  {stopReason}
                </span>
              )}
            </div>
            {hasDetail && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-status-error/70 hover:text-status-error mt-0.5 flex items-center gap-1 cursor-pointer"
              >
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
                {expanded ? "收起详情" : "查看详情"}
              </button>
            )}
            {hasDetail && expanded && (
              <pre className="mt-1.5 text-xs text-status-error/80 bg-status-error/5 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                {detail}
              </pre>
            )}
          </div>
          <button
            onClick={handleCopy}
            className="shrink-0 p-1 hover:bg-status-error/20 rounded transition-colors"
            title="复制错误信息"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-status-success" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-status-error/60" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});
