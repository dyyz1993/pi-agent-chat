import { memo, useCallback } from "react";
import { Trash2, Brain, Sparkles, X } from "lucide-react";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSessionStore } from "../../stores/use-session-store";
import { apiClient } from "../../lib/api-client";
import type { ChatMessage, TokenUsage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

interface Props {
  messageIds: string[];
  messages: (ChatMessage & { tokenUsage?: TokenUsage })[];
  onDeleteSelected?: (ids: string[]) => void;
}

export const MessageSelectionBar = memo(function MessageSelectionBar({ messages, onDeleteSelected }: Props) {
  const sessionId = useSessionStore((s) => s.activeSessionId);
  const selectedIds = useTurnStore(
    useCallback((s) => sessionId ? (s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET) : EMPTY_SET, [sessionId])
  );
  const clear = useTurnStore((s) => s.clearSelection);

  const handleDelete = useCallback(() => {
    if (onDeleteSelected) onDeleteSelected(Array.from(selectedIds));
  }, [onDeleteSelected, selectedIds]);

  const handleSummarize = useCallback(() => {
    void Array.from(selectedIds);
  }, [selectedIds]);

  const handleRemember = useCallback(() => {
    const sessionId = useSessionStore.getState().activeSessionId;
    const sessionStore = useSessionStore.getState();
    const projectPath = (() => {
      const tab = sessionStore.projectTabs.find((t) => t.id === sessionStore.activeProjectId);
      return tab?.path ?? "";
    })();
    if (!sessionId || !projectPath) return;
    const selectedMessages = messages.filter((m) => selectedIds.has(m.id));
    const content = selectedMessages
      .map((m) => {
        const text = m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        return `[${m.role}]: ${text}`;
      })
      .join("\n\n");
    const messageIds = Array.from(selectedIds);
    apiClient.call("memory.remember", {
      projectPath,
      sessionId,
      messageIds,
      content,
    }).catch(() => {});
    clear();
  }, [messages, selectedIds, clear]);

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
    <div className="mx-auto w-fit flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/90 border border-gray-700/60 shadow-lg backdrop-blur-sm">
      <span className="text-sm font-semibold text-indigo-400 tabular-nums leading-none min-w-[1.25rem] text-center">{count}</span>
      {(input > 0 || output > 0) && (
        <>
          <div className="w-px h-3.5 bg-gray-700" />
          <span className="text-[11px] text-gray-400 font-mono tabular-nums">{formatTokenCount(input)}</span>
          <span className="text-[11px] text-emerald-400/70 font-mono tabular-nums">{formatTokenCount(output)}</span>
        </>
      )}
      <div className="w-px h-3.5 bg-gray-700" />
      <button onClick={handleSummarize} className="flex items-center justify-center w-7 h-7 rounded-full text-purple-400 hover:text-purple-300 hover:bg-purple-500/15 transition-colors" title="总结所选">
        <Sparkles className="w-3.5 h-3.5" />
      </button>
      <button onClick={handleRemember} className="flex items-center justify-center w-7 h-7 rounded-full text-teal-400 hover:text-teal-300 hover:bg-teal-500/15 transition-colors" title="存为记忆">
        <Brain className="w-3.5 h-3.5" />
      </button>
      <button onClick={handleDelete} className="flex items-center justify-center w-7 h-7 rounded-full text-gray-500 hover:text-red-400 hover:bg-red-500/15 transition-colors" title="删除所选">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-3.5 bg-gray-700" />
      <button onClick={clear} className="flex items-center justify-center w-7 h-7 rounded-full text-gray-500 hover:text-gray-300 hover:bg-gray-700/60 transition-colors" title="取消选择">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});
