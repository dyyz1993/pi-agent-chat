import { memo, useState, useEffect, useRef, useCallback } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock, SubagentSessionInfo } from "../../../types";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { AnsiText } from "../primitives/AnsiText";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

export const SubagentExecutionCard = memo(function SubagentExecutionCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const isDone = block.status === "done";
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);

  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let description = "";
  let instruction = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as { description?: string; instruction?: string };
    description = parsed.description ?? "";
    instruction = parsed.instruction ?? "";
  } catch {
    /* args not valid JSON, use default */
  }

  const displayTitle = description || instruction.slice(0, 120) || t("subagent.subagentTask");

  const matchedSub = useSubagentStore((s): SubagentSessionInfo | null => {
    for (const subs of Object.values(s.subsessionsByParent)) {
      const found = subs.find(
        (sub) => sub.toolCallId === block.toolCallId || sub.description === description,
      );
      if (found) return found;
    }
    return null;
  });

  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const handleJumpToSession = useCallback(() => {
    if (!matchedSub) return;
    const childSessionId = matchedSub.sessionId;
    if (!childSessionId) return;
    const subStore = useSubagentStore.getState();
    if (activeSessionId) {
      subStore.setActiveSubsession(activeSessionId, childSessionId);
    }
  }, [matchedSub, activeSessionId]);

  let borderBg: string;
  if (isRunning) {
    borderBg = "border-semantic-agent/25 bg-semantic-agent/5 dark:bg-semantic-agent/10";
  } else if (isError) {
    borderBg = "border-status-error/20 bg-status-error/10 dark:bg-status-error/15";
  } else {
    borderBg = "border-border-secondary/30 bg-surface-dim";
  }

  const status: ToolCardStatus = isRunning ? "running" : isError ? "error" : "done";

  let statusText: string;
  if (isRunning) statusText = t("subagent.running");
  else if (isDone) statusText = t("subagent.completed");
  else statusText = t("subagent.error");

  let statusColorClass: string;
  if (isRunning) statusColorClass = "text-semantic-agent animate-pulse";
  else if (isDone) statusColorClass = "text-status-success";
  else statusColorClass = "text-status-error";

  const badgeContent = (
    <>
      <span className={`shrink-0 text-[10px] ${statusColorClass}`}>{statusText}</span>
      {matchedSub && !isRunning && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleJumpToSession();
          }}
          className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-semantic-agent hover:text-semantic-agent hover:bg-semantic-agent/10 transition-colors"
          title={t("subagent.view")}
        >
          <ExternalLink className="w-3 h-3" />
        </button>
      )}
    </>
  );

  return (
    <div
      data-block-id={blockId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}
    >
      <ToolCardHeader
        toolName="subagent"
        status={status}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        badge={badgeContent}
      />

      {!collapsed && block.output && (
        <div className="px-3 pb-2 pt-0.5 max-h-64 overflow-y-auto">
          <AnsiText content={block.output} className="text-[11px] leading-relaxed" />
        </div>
      )}

      {!collapsed && isRunning && !block.output && instruction && (
        <div className="px-3 pb-2 pt-0.5">
          <span className="text-[11px] text-semantic-agent/70 italic truncate block">
            {instruction.slice(0, 200)}
          </span>
        </div>
      )}
    </div>
  );
});
