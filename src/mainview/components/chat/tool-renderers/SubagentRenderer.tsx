import { memo, useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ChatMessage, ContentBlock, SubagentSessionInfo } from "../../../types";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useSessionStore } from "../../../stores/use-session-store";
import { useChatStore } from "../../../stores/use-chat-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { useAgentStore } from "../../../stores/use-agent-store";
import { agentColorStyle } from "../../../utils/agent-color";
import { useJumpToSession } from "../primitives/useJumpToSession";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import {
  SessionActivitySummary,
  buildActivityRoundsFromMessages,
  createSessionActivityLabels,
} from "./SessionActivitySummary";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("subagent");
const EMPTY_SUBAGENT_MESSAGES: ChatMessage[] = [];
const SUBAGENT_MARKDOWN_CLASS =
  "text-[11px] text-text-primary prose dark:prose-invert prose-sm max-w-none max-h-64 overflow-y-auto prose-p:my-1 prose-pre:my-1 prose-headings:my-1 prose-headings:text-text-primary dark:prose-headings:text-text-primary prose-strong:text-text-primary dark:prose-strong:text-text-primary prose-code:text-text-primary dark:prose-code:text-text-primary";

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
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);

  let description = "";
  let instruction = "";
  let requestedAgent = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as {
      agent?: string;
      description?: string;
      instruction?: string;
    };
    requestedAgent = parsed.agent ?? "";
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
  const subMessages = useChatStore((s) =>
    subSessionId
      ? (s.messagesBySession?.[subSessionId] ?? EMPTY_SUBAGENT_MESSAGES)
      : EMPTY_SUBAGENT_MESSAGES,
  );
  const subagentStatus = useSubagentStore((s) =>
    subSessionId ? s.subagentStatusMap?.[subSessionId] : undefined,
  );
  const hasFinalOutput = Boolean(block.output?.trim());
  const subagentHasCompleted = Boolean(matchedSub?.completedAt);
  const subagentHasError =
    block.status === "error" ||
    Boolean(matchedSub?.error) ||
    (typeof matchedSub?.exitCode === "number" && matchedSub.exitCode !== 0);
  const hasLiveSignal = isLiveSubagentStatus(subagentStatus) || block.status === "running";
  const isRunning = !hasFinalOutput && !subagentHasCompleted && !subagentHasError && hasLiveSignal;
  const isError = !isRunning && subagentHasError;
  const isDone = !isRunning && !isError;

  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

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

  const { canJump, handleJump } = useJumpToSession(matchedSub?.sessionId);

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

  const activityRoundLabels = useMemo(() => createSessionActivityLabels(t), [t]);
  const isTerminal = hasFinalOutput || subagentHasCompleted || subagentHasError;
  const activityRounds = useMemo(
    () =>
      buildActivityRoundsFromMessages(subMessages, activityRoundLabels, undefined, {
        forceTerminal: isTerminal,
      }),
    [activityRoundLabels, isTerminal, subMessages],
  );
  const isLive =
    !hasFinalOutput && !subagentHasCompleted && !subagentHasError && isLiveSubagentStatus(subagentStatus);
  const agentName = matchedSub?.agent ?? requestedAgent;
  const shortSessionId = matchedSub?.sessionId
    ? matchedSub.sessionId.replace(/^sess_/, "").slice(0, 12)
    : "";

  const badgeContent = (
    <>
      {agentName && (
        <span
          className="shrink-0 text-[10px] px-1 py-0.5 rounded font-mono"
          style={
            currentAgentColor
              ? { backgroundColor: currentAgentColor.bg, color: currentAgentColor.color }
              : undefined
          }
        >
          {agentName}
        </span>
      )}
      {shortSessionId && (
        <span className="shrink-0 text-[10px] px-1 py-0.5 rounded font-mono text-text-tertiary bg-surface-hover/60">
          {shortSessionId}
        </span>
      )}
      <span className={`shrink-0 text-[10px] ${statusColorClass}`}>{statusText}</span>
      {canJump && <SessionJumpButton onJump={handleJump} title={t("subagent.view")} />}
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
          <div className={SUBAGENT_MARKDOWN_CLASS}>
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});
