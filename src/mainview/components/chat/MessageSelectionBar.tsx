import { memo, useCallback } from "react";
import { Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import type { ChatMessage, TokenUsage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

interface Props {
  messageIds: string[];
  messages: (ChatMessage & { tokenUsage?: TokenUsage })[];
  onDeleteSelected?: (ids: string[]) => void;
}

export const MessageSelectionBar = memo(function MessageSelectionBar({
  messages,
  onDeleteSelected,
}: Props) {
  const { t } = useTranslation("chat");
  const sessionId = useSessionStore((s) => s.activeSessionId);
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

  return (
    <div className="mx-auto w-fit flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-dim/90 border border-border-secondary/60 shadow-lg backdrop-blur-sm">
      <span className="text-sm font-semibold text-semantic-accent tabular-nums leading-none min-w-[1.25rem] text-center">
        {count}
      </span>
      {(input > 0 || output > 0) && (
        <>
          <div className="w-px h-3.5 bg-border-secondary" />
          <span className="text-[11px] text-text-tertiary font-mono tabular-nums">
            {formatTokenCount(input)}
          </span>
          <span className="text-[11px] text-status-success/70 font-mono tabular-nums">
            {formatTokenCount(output)}
          </span>
        </>
      )}
      <div className="w-px h-3.5 bg-border-secondary" />
      <button
        onClick={handleDelete}
        className="flex items-center justify-center w-7 h-7 rounded-full text-text-tertiary hover:text-status-error hover:bg-status-error/15 transition-colors"
        title={t("deleteSelected")}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-3.5 bg-border-secondary" />
      <button
        onClick={clear}
        className="flex items-center justify-center w-7 h-7 rounded-full text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover/60 dark:hover:bg-surface-hover/60 transition-colors"
        title={t("cancelSelection")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});
