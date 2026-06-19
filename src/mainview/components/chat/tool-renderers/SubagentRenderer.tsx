import { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ContentBlock, SubagentSessionInfo } from "../../../types";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { useAgentStore } from "../../../stores/use-agent-store";
import { agentColorStyle } from "../../../utils/agent-color";
import { AnsiText } from "../primitives/AnsiText";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import {
  SessionActivitySummary,
  buildActivityRoundsFromMessages,
  createSessionActivityLabels,
} from "./SessionActivitySummary";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("subagent");

function isLiveSubagentStatus(status: string | undefined): boolean {
  return (
    status === "streaming" ||
    status === "compacting" ||
    status === "permission" ||
    status === "retrying"
  );
}

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
  } catch (e) {
    logger.warn("Failed to parse subagent args", { error: String(e) });
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
  const subSessionId = matchedSub?.sessionId;
  const subMessages = useSubagentStore((s) =>
    subSessionId ? (s.messagesBySubsession?.[subSessionId] ?? []) : [],
  );
  const subagentStatus = useSubagentStore((s) =>
    subSessionId ? s.subagentStatusMap?.[subSessionId] : undefined,
  );

  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const [now, setNow] = useState(Date.now());
  const startTime = matchedSub?.startedAt;
  const endTime = matchedSub?.completedAt;

  useEffect(() => {
    if (!startTime || endTime) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startTime, endTime]);

  const durationText = useMemo(() => {
    if (!startTime) return null;
    const end = endTime ?? now;
    const diffMs = end - startTime;
    if (diffMs < 0) return null;
    if (diffMs < 1000) return `${diffMs}ms`;
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remainSec = sec % 60;
    return remainSec > 0 ? `${min}m${remainSec}s` : `${min}m`;
  }, [startTime, endTime, now]);

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

  const currentAgentColor = activeSessionId
    ? agentColorStyle(useAgentStore.getState().agentDetailBySession[activeSessionId]?.color)
    : null;

  const status: ToolCardStatus = isRunning ? "running" : isError ? "error" : "done";

  let statusText: string;
  if (isRunning) statusText = t("subagent.running");
  else if (isDone) statusText = t("subagent.completed");
  else statusText = t("subagent.error");

  let statusColorClass: string;
  if (isRunning) statusColorClass = "text-semantic-agent animate-pulse";
  else if (isDone) statusColorClass = "text-status-success";
  else statusColorClass = "text-status-error";

  const canJump = !!matchedSub?.sessionId;
  const activityRoundLabels = useMemo(() => createSessionActivityLabels(t), [t]);
  const activityRounds = useMemo(
    () => buildActivityRoundsFromMessages(subMessages, activityRoundLabels),
    [activityRoundLabels, subMessages],
  );
  const isLive = isRunning || isLiveSubagentStatus(subagentStatus);

  const badgeContent = (
    <>
      {matchedSub?.agent && (
        <span
          className="shrink-0 text-[10px] px-1 py-0.5 rounded font-mono"
          style={
            currentAgentColor
              ? { backgroundColor: currentAgentColor.bg, color: currentAgentColor.color }
              : undefined
          }
        >
          {matchedSub.agent}
        </span>
      )}
      <span className={`shrink-0 text-[10px] ${statusColorClass}`}>{statusText}</span>
      {canJump && (
        <SessionJumpButton onJump={handleJumpToSession} title={t("subagent.view")} />
      )}
    </>
  );

  return (
    <div
      data-block-id={blockId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b transition-colors ${borderBg}`}
    >
      <ToolCardHeader
        toolName="subagent"
        status={status}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        badge={badgeContent}
        time={
          durationText ? (
            <span className="shrink-0 text-[10px] text-text-tertiary/50 tabular-nums">
              {durationText}
            </span>
          ) : undefined
        }
      />

      {!collapsed && instruction && (
        <div className="px-3 pb-2 pt-0.5 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">
            {t("subagent.input")}
          </div>
          <span className="text-[11px] text-semantic-agent/70 italic block">
            {instruction.slice(0, 500)}
          </span>
        </div>
      )}

      {!collapsed && (
        <SessionActivitySummary
          title={t("coordinator.activity")}
          rounds={activityRounds}
          live={isLive}
          labels={activityRoundLabels}
        />
      )}

      {!collapsed && block.output && (
        <div className="px-3 pb-2 pt-0.5 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">
            {t("subagent.output")}
          </div>
          <AnsiText content={block.output} className="text-[11px] leading-relaxed" />
        </div>
      )}
    </div>
  );
});
