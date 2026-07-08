import { memo, useCallback } from "react";
import { BookmarkPlus, ListCollapse, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import type { ChatMessage, TokenUsage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

interface Props {
  messageIds: string[];
  messages: (ChatMessage & { tokenUsage?: TokenUsage })[];
  onSummarizeSelected?: (ids: string[]) => void;
  onRememberSelected?: (ids: string[]) => void;
  onDeleteSelected?: (ids: string[]) => void;
}

export const MessageSelectionBar = memo(function MessageSelectionBar({
  messages,
  onSummarizeSelected,
  onRememberSelected,
  onDeleteSelected,
}: Props) {
  const { t } = useTranslation("chat");
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const contextTokens = useSessionStore((s) =>
    sessionId ? (s.sessionContextMap[sessionId]?.tokens ?? null) : null,
  );
  const selectedIds = useTurnStore(
    useCallback(
      (s) => (sessionId ? (s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET) : EMPTY_SET),
      [sessionId],
    ),
  );
  const clear = useTurnStore((s) => s.clearSelection);

  const handleDelete = useCallback(() => {
    if (onDeleteSelected) onDeleteSelected(Array.from(selectedIds));
  }, [onDeleteSelected, selectedIds]);
  const handleSummarize = useCallback(() => {
    if (onSummarizeSelected) onSummarizeSelected(Array.from(selectedIds));
  }, [onSummarizeSelected, selectedIds]);
  const handleRemember = useCallback(() => {
    if (onRememberSelected) onRememberSelected(Array.from(selectedIds));
  }, [onRememberSelected, selectedIds]);

  const count = selectedIds.size;
  if (count === 0) return null;

  let input = 0;
  let output = 0;
  for (const msg of messages) {
    if (!selectedIds.has(msg.id)) continue;
    const tu = msg.tokenUsage;
    if (tu) {
      input += tu.input + (tu.reasoning ?? 0);
      output += tu.output;
    }
  }
  const selectedTokens = input + output;
  const projectedTokensAfterDelete =
    typeof contextTokens === "number" ? Math.max(0, contextTokens - selectedTokens) : null;

  return (
    <div className="mx-auto w-fit max-w-[calc(100vw-2rem)] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-dim/90 border border-border-secondary/60 shadow-lg backdrop-blur-sm">
      <span
        className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent-text tabular-nums leading-none"
        title={t("selection.selectedCountTitle")}
      >
        <span className="text-text-tertiary">{t("selection.selectedShort")}</span>
        <span className="text-sm font-semibold">{count}</span>
      </span>
      {selectedTokens > 0 && (
        <>
          <div className="w-px h-3.5 bg-border-secondary" />
          <span
            className="inline-flex items-baseline gap-1 text-[11px] text-text-tertiary tabular-nums"
            title={t("selection.selectedTokensTitle")}
          >
            <span>{t("selection.selectedTokensShort")}</span>
            <span className="font-mono text-text-secondary">
              {formatTokenCount(selectedTokens)}
            </span>
          </span>
          {projectedTokensAfterDelete != null && (
            <span
              className="inline-flex items-baseline gap-1 text-[11px] text-status-success/80 tabular-nums"
              title={t("selection.afterDeleteTokensTitle")}
            >
              <span>{t("selection.afterDeleteTokensShort")}</span>
              <span className="font-mono">{formatTokenCount(projectedTokensAfterDelete)}</span>
            </span>
          )}
        </>
      )}
      <div className="w-px h-3.5 bg-border-secondary" />
      <button
        onClick={handleSummarize}
        className="flex items-center justify-center w-7 h-7 rounded-full text-status-warning bg-status-warning/10 border border-status-warning/15 hover:bg-status-warning/20 transition-colors"
        title={t("summarizeSelected")}
      >
        <ListCollapse className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleRemember}
        className="flex items-center justify-center w-7 h-7 rounded-full text-status-success bg-status-success/10 border border-status-success/15 hover:bg-status-success/20 transition-colors"
        title={t("saveAsMemory")}
      >
        <BookmarkPlus className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleDelete}
        className="flex items-center justify-center w-7 h-7 rounded-full text-status-error bg-status-error/10 border border-status-error/15 hover:bg-status-error/20 transition-colors"
        title={t("deleteSelected")}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-3.5 bg-border-secondary" />
      <button
        onClick={clear}
        className="flex items-center justify-center w-7 h-7 rounded-full text-text-tertiary bg-surface-hover/40 border border-border-secondary/40 hover:text-text-primary hover:bg-surface-hover/70 transition-colors"
        title={t("cancelSelection")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});
