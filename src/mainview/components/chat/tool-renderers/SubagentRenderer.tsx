import { memo, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ChatMessage, ContentBlock, SubagentSessionInfo } from "../../../types";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useChatStore } from "../../../stores/use-chat-store";
import { useAgentStore } from "../../../stores/use-agent-store";
import { agentColorStyle } from "../../../utils/agent-color";
import { useJumpToSession } from "../primitives/useJumpToSession";
import type { ToolCardStatus } from "../primitives/ToolCardHeader";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import {
  buildActivityRoundsFromMessages,
  createSessionActivityLabels,
} from "./SessionActivitySummary";
import { SessionTaskCard } from "./SessionTaskCard";
import {
  mergeSessionTaskModelInfo,
  SessionTaskModelBadges,
} from "./SessionTaskModelBadges";
import { useSessionTaskModelFallback } from "./useSessionTaskModelFallback";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("subagent");
const EMPTY_SUBAGENT_MESSAGES: ChatMessage[] = [];
const BUILTIN_AGENT_COLORS: Record<string, string> = {
  build: "orange",
  explore: "blue",
  plan: "purple",
};

function isLiveSubagentStatus(status: string | undefined): boolean {
  return (
    status === "streaming" ||
    status === "compacting" ||
    status === "permission" ||
    status === "retrying"
  );
}

function getStringArg(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : "";
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

export const SubagentExecutionCard = memo(function SubagentExecutionCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");

  let description = "";
  let instruction = "";
  let requestedAgent = "";
  let requestedTier = "";
  let requestedModel = "";
  let requestedProvider = "";
  let requestedThinkingLevel = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as Record<string, unknown>;
    requestedAgent = getStringArg(parsed, "agent");
    requestedTier = getStringArg(parsed, "tier");
    requestedModel = getStringArg(parsed, "model");
    requestedProvider = getStringArg(parsed, "provider");
    requestedThinkingLevel = getStringArg(parsed, "thinkingLevel");
    description = getStringArg(parsed, "description");
    instruction =
      getStringArg(parsed, "instruction") ||
      getStringArg(parsed, "task") ||
      getStringArg(parsed, "prompt") ||
      getStringArg(parsed, "message");
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
  const agents = useAgentStore((s) => s.agents);

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
  const agentName = firstNonEmptyString(matchedSub?.agent, requestedAgent) ?? "build";
  const agentColorName =
    agents.find((agent) => agent.name === agentName)?.color ?? BUILTIN_AGENT_COLORS[agentName];
  const agentBadgeStyle = agentColorStyle(agentColorName);
  const shortSessionId = matchedSub?.sessionId
    ? matchedSub.sessionId.replace(/^sess_/, "").slice(0, 12)
    : "";
  const modelFallback = useSessionTaskModelFallback();
  const modelInfo = mergeSessionTaskModelInfo(
    {
      tier: requestedTier,
      model: firstNonEmptyString(matchedSub?.model, requestedModel),
      provider: firstNonEmptyString(matchedSub?.provider, requestedProvider),
      thinkingLevel: requestedThinkingLevel,
    },
    modelFallback,
  );

  const badgeContent = (
    <>
      {agentName && (
        <span
          className="shrink-0 text-[10px] px-1 py-0.5 rounded font-mono"
          style={
            agentBadgeStyle
              ? { backgroundColor: agentBadgeStyle.bg, color: agentBadgeStyle.color }
              : undefined
          }
        >
          {agentName}
        </span>
      )}
      <SessionTaskModelBadges
        tier={modelInfo.tier}
        model={modelInfo.model}
        provider={modelInfo.provider}
        thinkingLevel={modelInfo.thinkingLevel}
      />
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
    <SessionTaskCard
      blockId={blockId}
      toolName="subagent"
      status={status}
      title={displayTitle}
      badge={badgeContent}
      time={
        durationText ? (
          <span className="shrink-0 text-[10px] text-text-tertiary/50 tabular-nums">
            {durationText}
          </span>
        ) : undefined
      }
      input={
        instruction
          ? { label: t("subagent.input"), text: instruction.slice(0, 500) }
          : undefined
      }
      activity={{
        title: t("coordinator.activity"),
        rounds: activityRounds,
        live: isLive,
        labels: activityRoundLabels,
      }}
      result={
        block.output
          ? { label: t("subagent.output"), text: block.output, copyText: block.output }
          : undefined
      }
    />
  );
});
