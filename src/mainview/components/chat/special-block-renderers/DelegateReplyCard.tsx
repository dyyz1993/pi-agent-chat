import { memo } from "react";
import { ExternalLink } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";
import { useSessionStore } from "../../../stores/use-session-store";

export const DelegateReplyCard = memo(function DelegateReplyCard({
  block,
}: SpecialBlockRendererProps) {
  const { from, title, elapsed, historyCount } = block.attrs;

  const handleJumpToSession = () => {
    const sessionId = from;
    if (!sessionId) return;

    const state = useSessionStore.getState();
    const { sessionsByProject, projectTabs, activeProjectId } = state;

    for (const tab of projectTabs) {
      const sessions = sessionsByProject[tab.path];
      const found = sessions?.find((s) => s.sessionId === sessionId);
      if (found) {
        if (tab.id !== activeProjectId) {
          state.setActiveProject(tab.id, { skipAutoSession: true });
        }
        state.setActiveSession(sessionId, true);
        return;
      }
    }
  };

  return (
    <div className="my-1 rounded-md border border-border-secondary/40 bg-surface-dim/50">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs min-w-0">
        <ExternalLink className="w-3 h-3 shrink-0 text-semantic-agent/70" />
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-semantic-agent/10 text-semantic-agent text-[10px] font-medium">
          委托回复
        </span>
        {title && <span className="font-medium text-text-primary truncate">{title}</span>}
        {elapsed && <span className="text-text-tertiary text-[10px] shrink-0">{elapsed}</span>}
        {historyCount && (
          <span className="text-text-tertiary text-[10px] shrink-0">({historyCount}条历史)</span>
        )}
        {from && (
          <button
            onClick={handleJumpToSession}
            className="ml-auto shrink-0 p-0.5 rounded text-text-secondary hover:text-semantic-agent hover:bg-surface-hover transition-colors"
            title="跳转到对应会话"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {block.body && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-border-secondary/30 text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed">
          {block.body}
        </div>
      )}
    </div>
  );
});

registerSpecialBlock("delegate-reply", DelegateReplyCard);
