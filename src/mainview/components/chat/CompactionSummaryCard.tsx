import { memo, useMemo, useState } from "react";
import { AlertCircle, Archive, CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import {
  CHAT_COMPACT_BLOCK_CLASS,
  CHAT_COMPACT_ROW_BUTTON_BASE_CLASS,
} from "./chat-layout-classes";
import { formatDuration } from "./primitives/formatDuration";

export const CompactionSummaryCard = memo(function CompactionSummaryCard({
  summary,
  blockId,
  tokensBefore,
  status,
  reason,
  startedAt,
}: {
  summary: string;
  blockId: string;
  tokensBefore?: number;
  status?: "running" | "completed" | "failed" | "aborted";
  reason?: string;
  startedAt?: number;
}) {
  const { t } = useTranslation("chat");
  const [isOpen, setIsOpen] = useState(false);
  const effectiveStatus = status ?? "completed";
  const isRunning = effectiveStatus === "running";

  const lines = summary.split("\n");
  const firstMeaningfulLine = lines.find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "";
  const preview = isRunning
    ? t("compactingHint")
    : firstMeaningfulLine.slice(0, 120);
  const isLong = !isRunning && (summary.length > 200 || lines.length > 6);
  const elapsed = useMemo(() => {
    if (!startedAt) return null;
    return formatDuration(Date.now() - startedAt);
  }, [startedAt]);

  const statusConfig =
    effectiveStatus === "running"
      ? {
          icon: Loader2,
          iconClass: "animate-spin text-semantic-agent",
          label: t("compacting"),
          color: "text-semantic-agent",
        }
      : effectiveStatus === "failed" || effectiveStatus === "aborted"
        ? {
            icon: AlertCircle,
            iconClass: "text-status-warning",
            label: effectiveStatus === "aborted" ? t("compactionAborted") : t("compactionFailed"),
            color: "text-status-warning",
          }
        : {
            icon: CheckCircle2,
            iconClass: "text-status-success",
            label: t("contextCompaction"),
            color: "text-semantic-tool",
          };
  const StatusIcon = statusConfig.icon;

  return (
    <div data-block-id={blockId} className={CHAT_COMPACT_BLOCK_CLASS}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${CHAT_COMPACT_ROW_BUTTON_BASE_CLASS} ${statusConfig.color} hover:bg-surface-hover/15 dark:hover:bg-surface-dim/15`}
        aria-expanded={isOpen}
        aria-label={`${statusConfig.label}${preview ? `: ${preview}` : ""}`}
      >
        <Archive className="w-3 h-3 shrink-0 opacity-80" />
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="font-medium whitespace-nowrap">{statusConfig.label}</span>
          {preview && <span className="text-text-tertiary truncate">{preview}</span>}
        </span>
        {tokensBefore != null && (
          <span className="shrink-0 text-[10px] text-text-tertiary/60 tabular-nums">
            {Math.round(tokensBefore / 1000)}k
          </span>
        )}
        {elapsed && (
          <span className="shrink-0 text-[10px] text-text-tertiary/50 tabular-nums">
            {elapsed}
          </span>
        )}
        <StatusIcon className={`w-3 h-3 shrink-0 ${statusConfig.iconClass}`} />
      </button>
      {isOpen && (
        <div className="px-3 pb-2 text-[11px] text-text-secondary leading-relaxed space-y-2">
          {reason && (
            <div className="flex gap-1.5">
              <span className="text-text-tertiary shrink-0">{t("compactionReason")}</span>
              <span>{reason}</span>
            </div>
          )}
          {tokensBefore != null && (
            <div className="flex gap-1.5">
              <span className="text-text-tertiary shrink-0">{t("tokensBeforeCompaction")}</span>
              <span>{tokensBefore.toLocaleString()}</span>
            </div>
          )}
          {isRunning ? (
            <div className="flex items-center gap-1.5 text-semantic-agent">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              <span>{t("compactingHint")}</span>
            </div>
          ) : isLong ? (
            <div className="border-l-2 border-semantic-tool/20 pl-2 prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
              <CachedReactMarkdown>{summary}</CachedReactMarkdown>
            </div>
          ) : (
            <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-0.5 prose-headings:my-1">
              <CachedReactMarkdown>{summary}</CachedReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
