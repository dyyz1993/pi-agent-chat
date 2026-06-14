import { memo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { useSettingsStore } from "../../stores/use-settings-store";

export const ThinkingCard = memo(function ThinkingCard({
  thinking,
  isStreaming,
  blockId,
}: {
  thinking: string;
  isStreaming: boolean;
  blockId: string;
}) {
  const { t } = useTranslation("chat");
  const collapseThinking = useSettingsStore((s) => s.collapseThinking);
  const [isOpen, setIsOpen] = useState(() => (collapseThinking ? isStreaming : true));

  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setIsOpen(!collapseThinking);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, collapseThinking]);

  const trimmed = thinking.trim();
  const firstLine = trimmed.split("\n")[0] || "";
  const collapsedText = firstLine.length > 100 ? firstLine.slice(0, 100) + "…" : firstLine;

  return (
    <div className="my-0.5 overflow-hidden" data-block-id={blockId}>
      {/* Header row — when collapsed, shows icon + truncated text + buttons all on one line */}
      <div
        className={`px-3 py-1 text-[11px] flex items-center gap-2 ${!isStreaming ? "cursor-pointer hover:bg-surface-hover/30 dark:hover:bg-surface-dim/30" : ""}`}
        onClick={() => !isStreaming && setIsOpen(!isOpen)}
      >
        <Brain className="w-3 h-3 text-semantic-agent/60 shrink-0" />
        {isOpen ? (
          <span className="text-semantic-agent/70 font-medium">{t("thinkingLabel")}</span>
        ) : collapsedText ? (
          <span className="text-text-secondary truncate flex-1 min-w-0">{collapsedText}</span>
        ) : (
          <span className="text-semantic-agent/50 italic">{t("thinkingPlaceholder")}</span>
        )}
        {isStreaming && (
          <span className="text-semantic-agent/50 animate-pulse text-[10px]">...</span>
        )}
        {!isStreaming && (
          <div
            className="ml-auto flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsOpen(!isOpen)}
              title={isOpen ? t("collapse") : t("expand")}
              className="p-0.5 text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
            >
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <CopyButton text={thinking} size="xs" title={t("copyThinkingContent")} />
          </div>
        )}
      </div>

      {isOpen && (
        <div className="px-3 pb-2 text-[11px] text-text-secondary whitespace-pre-wrap leading-relaxed">
          {thinking || (
            <span className="text-text-secondary italic">{t("thinkingPlaceholder")}</span>
          )}
        </div>
      )}
    </div>
  );
});
