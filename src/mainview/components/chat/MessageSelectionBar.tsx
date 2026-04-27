import { memo, useCallback } from "react";
import { Trash2, X } from "lucide-react";
import { useTurnStore } from "../../stores/use-turn-store";
import type { ChatMessage, TokenUsage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

interface Props {
  messageIds: string[];
  messages: (ChatMessage & { tokenUsage?: TokenUsage })[];
  onDeleteSelected?: (ids: string[]) => void;
}

export const MessageSelectionBar = memo(function MessageSelectionBar({ messages, onDeleteSelected }: Props) {
  const selectedIds = useTurnStore((s) => s.selectedMessageIds);
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
    <div className="-mt-1 mx-auto w-fit flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-950/80 border border-red-500/30 shadow-md">
      <span className="text-sm font-semibold text-red-400 tabular-nums leading-none">{count}</span>
      {(input > 0 || output > 0) && (
        <>
          <div className="w-px h-3.5 bg-red-500/20" />
          <span className="text-[11px] text-gray-300 font-mono tabular-nums">{formatTokenCount(input)}</span>
          <span className="text-[11px] text-emerald-400/70 font-mono tabular-nums">{formatTokenCount(output)}</span>
        </>
      )}
      <div className="w-px h-3.5 bg-red-500/20" />
      <button onClick={handleDelete} className="flex items-center justify-center w-6 h-6 rounded-full text-gray-500 hover:text-red-400 hover:bg-red-500/15 transition-colors" title="删除所选">
        <Trash2 className="w-3 h-3" />
      </button>
      <button onClick={clear} className="flex items-center justify-center w-6 h-6 rounded-full text-gray-500 hover:text-gray-300 hover:bg-gray-700/60 transition-colors" title="取消选择">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
});
