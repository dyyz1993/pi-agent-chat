import { memo, useState } from "react";
import { ExternalLink, ChevronDown } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { useSessionStore } from "../../../stores/use-session-store";
import { useAgentStore } from "../../../stores/use-agent-store";
import { useJumpToSession } from "../primitives/useJumpToSession";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import { agentColorStyle } from "../../../utils/agent-color";

export const DelegateReplyCard = memo(function DelegateReplyCard({
  block,
}: SpecialBlockRendererProps) {
  const { from, sessionId, title, elapsed, historyCount } = block.attrs;

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const agentDetailBySession = useAgentStore((s) => s.agentDetailBySession);
  const cs = activeSessionId ? agentColorStyle(agentDetailBySession[activeSessionId]?.color) : null;

  const [collapsed, setCollapsed] = useState(true);
  const { canJump, handleJump } = useJumpToSession(sessionId ?? from);

  const hasBody = !!block.body;

  return (
    <div
      className="my-1 rounded-md border border-border-secondary/40 bg-surface-dim/50"
      style={cs ? { borderColor: cs.border } : undefined}
    >
      <div
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs min-w-0 ${hasBody ? "cursor-pointer" : ""}`}
        onClick={hasBody ? () => setCollapsed((c) => !c) : undefined}
      >
        <ExternalLink className="w-3 h-3 shrink-0" style={cs ? { color: cs.color } : undefined} />
        <span
          className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={
            cs
              ? { backgroundColor: cs.bg, color: cs.color }
              : {
                  backgroundColor: "rgba(var(--color-semantic-agent), 0.1)",
                  color: "rgb(var(--color-semantic-agent))",
                }
          }
        >
          委托回复
        </span>
        {title && <span className="font-medium text-text-primary truncate">{title}</span>}
        {elapsed && <span className="text-text-tertiary text-[10px] shrink-0">{elapsed}</span>}
        {historyCount && (
          <span className="text-text-tertiary text-[10px] shrink-0">({historyCount}条历史)</span>
        )}
        {hasBody && (
          <ChevronDown
            className={`w-3 h-3 shrink-0 text-text-tertiary transition-transform ${collapsed ? "" : "rotate-180"}`}
          />
        )}
        {canJump && (
          <span className="ml-auto shrink-0">
            <SessionJumpButton onJump={handleJump} />
          </span>
        )}
      </div>
      {block.body && !collapsed && (
        <div className="px-2.5 pb-2 pt-0.5 border-t border-border-secondary/30 text-xs text-text-secondary break-words leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1 prose-headings:my-1">
          <CachedReactMarkdown>{block.body}</CachedReactMarkdown>
        </div>
      )}
    </div>
  );
});

registerSpecialBlock("delegate-reply", DelegateReplyCard);
