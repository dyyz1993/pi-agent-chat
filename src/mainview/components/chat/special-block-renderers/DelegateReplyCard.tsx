import { memo, useEffect, useRef, useState } from "react";
import { ExternalLink, ChevronDown } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { useSessionStore } from "../../../stores/use-session-store";
import { useAgentStore } from "../../../stores/use-agent-store";
import { useJumpToSession } from "../primitives/useJumpToSession";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import { agentColorStyle } from "../../../utils/agent-color";

const CONTEXT_ATTRS: Array<[string, string]> = [
  ["task", "任务"],
  ["instruction", "任务"],
  ["agent", "Agent"],
  ["projectPath", "项目"],
  ["replyMode", "回复"],
  ["params", "参数"],
];

export const DelegateReplyCard = memo(function DelegateReplyCard({
  block,
}: SpecialBlockRendererProps) {
  const { from, sessionId, title, elapsed, historyCount } = block.attrs;

  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const agentDetailBySession = useAgentStore((s) => s.agentDetailBySession);
  const cs = activeSessionId ? agentColorStyle(agentDetailBySession[activeSessionId]?.color) : null;

  const [collapsed, setCollapsed] = useState(true);
  const [showFull, setShowFull] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const userScrolledBodyRef = useRef(false);
  const { canJump, handleJump } = useJumpToSession(sessionId ?? from);

  const hasBody = !!block.body;
  const contextRows = CONTEXT_ATTRS.flatMap(([key, label]) => {
    const value = block.attrs[key];
    return value ? [{ key, label, value }] : [];
  });

  useEffect(() => {
    if (collapsed || showFull || userScrolledBodyRef.current) return;
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [block.body, collapsed, showFull]);

  const handleBodyScroll = () => {
    const element = bodyRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    userScrolledBodyRef.current = distanceFromBottom > 8;
  };

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
        <div className="border-t border-border-secondary/30 px-2.5 pb-2 pt-2">
          {contextRows.length > 0 && (
            <div className="mb-2 space-y-1 rounded bg-bg-secondary/50 px-2 py-1.5 text-[10px] text-text-tertiary">
              {contextRows.map((row) => (
                <div key={row.key} className="flex items-start gap-1.5">
                  <span className="shrink-0 font-medium text-text-secondary">{row.label}</span>
                  <span className="min-w-0 break-words font-mono">{row.value}</span>
                </div>
              ))}
            </div>
          )}
          <div
            ref={bodyRef}
            data-testid="delegate-reply-body"
            onScroll={handleBodyScroll}
            className={`text-xs text-text-secondary break-words leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1 prose-headings:my-1 ${
              showFull ? "" : "max-h-72 overflow-y-auto pr-1"
            }`}
          >
            <CachedReactMarkdown>{block.body}</CachedReactMarkdown>
          </div>
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => setShowFull((value) => !value)}
              className="text-[10px] font-medium text-semantic-accent hover:text-semantic-accent transition-colors"
            >
              {showFull ? "Collapse reply" : "View full reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

registerSpecialBlock("delegate-reply", DelegateReplyCard);
