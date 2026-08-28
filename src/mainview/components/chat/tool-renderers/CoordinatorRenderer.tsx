import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, ContentBlock, SessionMeta, SessionStatus } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useChatStore } from "../../../stores/use-chat-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { useAgentStore } from "../../../stores/use-agent-store";
import {
  useDelegateActivityStore,
  type DelegateActivity,
} from "../../../stores/use-delegate-activity-store";
import { agentColorStyle } from "../../../utils/agent-color";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";
import { useJumpToSession } from "../primitives/useJumpToSession";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { CopyButton } from "../CopyButton";
import { parseToolArgs } from "../../../utils/parse-tool-args";
import { tryFormatAsYaml } from "../../../../shared/lib/json-to-yaml";
import {
  buildActivityRoundsFromMessages,
  createSessionActivityLabels,
  type SessionActivityRound,
} from "./SessionActivitySummary";
import { SessionTaskCard } from "./SessionTaskCard";
import {
  mergeSessionTaskModelInfo,
  SessionTaskModelBadges,
  type SessionTaskModelInfo,
} from "./SessionTaskModelBadges";
import { useSessionTaskModelFallback } from "./useSessionTaskModelFallback";
import { SessionTaskWorktreeBadge } from "./SessionTaskWorktreeBadge";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
const EMPTY_SUBAGENT_MESSAGES: ChatMessage[] = [];
const TOOL_MARKDOWN_CLASS =
  "text-[11px] text-text-primary prose dark:prose-invert prose-sm max-w-none max-h-64 overflow-y-auto prose-p:my-1 prose-pre:my-1 prose-headings:my-1 prose-headings:text-text-primary dark:prose-headings:text-text-primary prose-strong:text-text-primary dark:prose-strong:text-text-primary prose-code:text-text-primary dark:prose-code:text-text-primary";
const BUILTIN_AGENT_COLORS: Record<string, string> = {
  build: "orange",
  explore: "blue",
  plan: "purple",
};

interface CoordinatorDetails {
  sessionId?: string;
  status?: string;
  detail?: {
    phase?: string;
    waitingType?: string;
    waitingSince?: number;
    lastMessages?: string[];
  };
  task?: string;
  title?: string;
  dispatchedBy?: string;
  forkedFrom?: string;
  delivered?: boolean;
  targetSessionId?: string;
  ok?: boolean;
  exitCode?: number;
  finalText?: string;
  error?: string;
  tier?: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
}

function parseArgs(args?: string): Record<string, unknown> {
  return parseToolArgs(args) ?? {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function agentValue(args: Record<string, unknown>): string | undefined {
  return stringValue(args.agent) ?? stringValue(args.agentName);
}

function extractDetails(detailData: unknown): CoordinatorDetails {
  if (!detailData || typeof detailData !== "object") return {};
  return detailData as CoordinatorDetails;
}

function parseOutputAsDetails(output: string | undefined): CoordinatorDetails {
  if (!output) return {};
  try {
    const parsed = JSON.parse(output) as unknown;
    return extractDetails(parsed);
  } catch {
    return {};
  }
}

function outputContainsOnlySerializedDetails(output: string | undefined): boolean {
  if (!output) return false;
  try {
    const parsed = JSON.parse(output) as unknown;
    return !!parsed && typeof parsed === "object";
  } catch {
    return false;
  }
}

function useTargetSessionStatus(sessionId: string | undefined): SessionStatus | undefined {
  return useSessionStore((s) => (sessionId ? s.sessionStatusMap[sessionId] : undefined));
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim();
}

function matchesDelegateSession(options: {
  session: SessionMeta;
  parentSessionId: string | null;
  sessionId?: string;
  taskText?: string;
  titleText?: string;
  projectPath?: string;
  delegateType: "coordinator" | "fork";
}): boolean {
  const { session, parentSessionId, sessionId, taskText, titleText, projectPath, delegateType } =
    options;
  if (sessionId && session.sessionId === sessionId) return true;
  if (!parentSessionId || session.delegateParentSessionId !== parentSessionId) return false;
  if (delegateType === "coordinator" && session.delegateType !== "coordinator") return false;
  if (delegateType === "fork" && session.delegateType !== "fork") return false;
  if (projectPath && session.projectPath !== projectPath) return false;

  const task = normalizeText(taskText);
  const title = normalizeText(titleText);
  const firstMessage = normalizeText(session.firstMessage);
  const name = normalizeText(session.name);

  if (task && firstMessage === task) return true;
  if (title && (name === title || name === `指派: ${title}`)) return true;
  return false;
}

function useDelegateSession(options: {
  sessionId?: string;
  taskText?: string;
  titleText?: string;
  projectPath?: string;
  delegateType: "coordinator" | "fork";
}): SessionMeta | undefined {
  return useSessionStore((s) => {
    const parentSessionId = s.activeSessionId;
    for (const sessions of Object.values(s.sessionsByProject)) {
      for (const session of sessions) {
        if (matchesDelegateSession({ session, parentSessionId, ...options })) {
          return session;
        }
      }
    }
    return undefined;
  });
}

function sessionStatusLabel(status: SessionStatus | undefined, t: (k: string) => string): string {
  switch (status) {
    case "streaming":
      return t("coordinator.streaming");
    case "compacting":
      return t("coordinator.compacting");
    case "permission":
      return t("coordinator.waitingPermission");
    case "retrying":
      return t("coordinator.retrying");
    case "idle":
      return t("coordinator.idle");
    default:
      return "";
  }
}

function toCardStatus(block: ToolExecBlock): ToolCardStatus {
  if (block.status === "running") return "running";
  if (block.status === "error") return "error";
  return "done";
}

function isLiveSessionStatus(status: SessionStatus | undefined): boolean {
  return (
    status === "streaming" ||
    status === "compacting" ||
    status === "permission" ||
    status === "retrying"
  );
}

function asSessionStatus(status: string | undefined): SessionStatus | undefined {
  if (
    status === "streaming" ||
    status === "compacting" ||
    status === "permission" ||
    status === "retrying" ||
    status === "idle"
  ) {
    return status;
  }
  return undefined;
}

function buildActivityRoundsFromDelegateActivity(
  activity?: DelegateActivity,
): SessionActivityRound[] {
  return (
    activity?.rounds.map((round) => ({
      id: round.id,
      index: round.index,
      status: round.status,
      summary: round.summary,
      summarySource: round.summary ? "content" : round.tools.length > 0 ? "tools" : "thinking",
      tools: round.tools.map((tool) => ({
        id: tool.toolCallId,
        name: tool.toolName,
        status: tool.status,
      })),
    })) ?? []
  );
}

function renderAgentBadge(
  agentName: string | undefined,
  agents: Array<{ name: string; color?: string }>,
): ReactNode {
  if (!agentName) return null;
  const colorName =
    agents.find((agent) => agent.name === agentName)?.color ?? BUILTIN_AGENT_COLORS[agentName];
  const style = agentColorStyle(colorName);
  return (
    <span
      className="shrink-0 text-[10px] px-1 py-0.5 rounded font-mono"
      style={style ? { backgroundColor: style.bg, color: style.color } : undefined}
    >
      {agentName}
    </span>
  );
}

function renderBadge(
  agentName: string | undefined,
  agents: Array<{ name: string; color?: string }>,
  modelInfo: SessionTaskModelInfo,
  statusLabel: string | undefined,
  isRunning: boolean,
  sessionStatus: SessionStatus | undefined,
  projectPath?: string,
  sessionId?: string,
): ReactNode {
  return (
    <>
      {renderAgentBadge(agentName, agents)}
      <SessionTaskModelBadges
        tier={modelInfo.tier}
        model={modelInfo.model}
        provider={modelInfo.provider}
        thinkingLevel={modelInfo.thinkingLevel}
      />
      <SessionTaskWorktreeBadge projectPath={projectPath} sessionId={sessionId} />
      {statusLabel && (
        <span
          className={`shrink-0 text-[10px] ${
            isRunning
              ? "text-status-info animate-pulse"
              : sessionStatus === "streaming"
                ? "text-status-warning"
                : "text-text-tertiary"
          }`}
        >
          {statusLabel}
        </span>
      )}
    </>
  );
}

export const DelegateCard = memo(function DelegateCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const blockRunning = block.status === "running";

  const args = parseArgs(block.args);
  const taskText = (args.task as string) ?? "";
  const titleText = (args.title as string) ?? taskText.slice(0, 60);
  const agentText = agentValue(args) ?? "build";
  const details = extractDetails(block.details);
  const rawModelInfo: SessionTaskModelInfo = {
    tier: stringValue(args.tier) ?? details.tier,
    model: stringValue(args.model) ?? details.model,
    provider: stringValue(args.provider) ?? details.provider,
    thinkingLevel: stringValue(args.thinkingLevel) ?? details.thinkingLevel,
  };
  const modelFallback = useSessionTaskModelFallback();
  const agents = useAgentStore((s) => s.agents);

  const requestedProjectPath = stringValue(args.projectPath);
  const matchedSession = useDelegateSession({
    sessionId: details.sessionId,
    taskText,
    titleText,
    projectPath: requestedProjectPath,
    delegateType: "coordinator",
  });
  const targetSessionId = details.sessionId ?? matchedSession?.sessionId;
  const targetProjectPath = requestedProjectPath ?? matchedSession?.projectPath;
  const modelInfo = mergeSessionTaskModelInfo(
    {
      ...rawModelInfo,
      tier: matchedSession?.tierConfig?.currentTier ?? rawModelInfo.tier,
    },
    modelFallback,
  );
  const { canJump, handleJump } = useJumpToSession(targetSessionId);
  const sessionStatus = useTargetSessionStatus(targetSessionId);
  const activity = useDelegateActivityStore((s) =>
    targetSessionId ? s.bySession[targetSessionId] : undefined,
  );
  const hasRunningActivity = activity?.status === "running";
  const hasErroredActivity = activity?.status === "error";
  const hasLiveSession = isLiveSessionStatus(sessionStatus) || hasRunningActivity;
  const isError = block.status === "error" || hasErroredActivity;
  const isRunning = !isError && (blockRunning || hasLiveSession);
  const delegateLive = isRunning || hasRunningActivity;

  const displayTitle = titleText || t("coordinator.delegateTask");

  const statusLabel = isError
    ? t("coordinator.error")
    : hasLiveSession
      ? sessionStatusLabel(sessionStatus, t) || t("coordinator.running")
      : sessionStatusLabel(sessionStatus, t) ||
        (matchedSession
          ? t("coordinator.dispatched")
          : blockRunning
            ? t("coordinator.creating")
            : undefined);

  const activityRoundLabels = useMemo(() => createSessionActivityLabels(t), [t]);
  const activityRounds = useMemo(
    () => buildActivityRoundsFromDelegateActivity(activity),
    [activity],
  );
  const cardStatus: ToolCardStatus = isRunning ? "running" : isError ? "error" : "done";

  return (
    <SessionTaskCard
      blockId={blockId}
      toolName="delegate"
      status={cardStatus}
      title={displayTitle}
      startedAt={block.startedAt}
      endedAt={block.endedAt}
      badge={renderBadge(
        agentText,
        agents,
        modelInfo,
        statusLabel,
        isRunning,
        sessionStatus,
        targetProjectPath,
        targetSessionId,
      )}
      action={canJump ? <SessionJumpButton onJump={handleJump} /> : undefined}
      input={taskText ? { label: "Input", text: taskText.slice(0, 500) } : undefined}
      activity={{
        title: t("coordinator.activity"),
        rounds: activityRounds,
        live: delegateLive,
        labels: activityRoundLabels,
      }}
      result={
        !isRunning && block.output
          ? { label: "Output", text: block.output, copyText: block.output }
          : undefined
      }
    />
  );
});

export const ForkCard = memo(function ForkCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const blockRunning = block.status === "running";
  const isError = block.status === "error";

  const args = parseArgs(block.args);
  const taskText = (args.task as string) ?? "";
  const titleText = (args.title as string) ?? taskText.slice(0, 60);
  const agentText = agentValue(args) ?? "build";
  const details = extractDetails(block.details);
  const modelFallback = useSessionTaskModelFallback();
  const modelInfo = mergeSessionTaskModelInfo(
    {
      tier: stringValue(args.tier) ?? details.tier,
      model: stringValue(args.model) ?? details.model,
      provider: stringValue(args.provider) ?? details.provider,
      thinkingLevel: stringValue(args.thinkingLevel) ?? details.thinkingLevel,
    },
    modelFallback,
  );

  const sessionId = details.sessionId;
  const { canJump, handleJump } = useJumpToSession(sessionId);
  const sessionStatus = useTargetSessionStatus(sessionId);
  const hasLiveSession = isLiveSessionStatus(sessionStatus);
  const isRunning = !isError && (blockRunning || hasLiveSession);
  const agents = useAgentStore((s) => s.agents);

  const displayTitle = titleText || t("coordinator.forkTask");

  const statusLabel = isError
    ? t("coordinator.error")
    : hasLiveSession
      ? sessionStatusLabel(sessionStatus, t) || t("coordinator.running")
      : block.status === "done"
        ? sessionStatusLabel(sessionStatus, t) || t("coordinator.dispatched")
        : isRunning
          ? t("coordinator.forking")
          : undefined;

  return (
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden transition-colors ${
        isRunning
          ? "border-status-info/25 bg-status-info/5"
          : isError
            ? "border-status-error/15 bg-status-error/5"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <ToolCardHeader
        toolName="fork"
        status={isRunning ? "running" : isError ? "error" : "done"}
        description={displayTitle}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={renderBadge(
          agentText,
          agents,
          modelInfo,
          statusLabel,
          isRunning,
          sessionStatus,
          undefined,
          sessionId,
        )}
        action={canJump ? <SessionJumpButton onJump={handleJump} /> : undefined}
      />
    </div>
  );
});

export const DelegateSendCard = memo(function DelegateSendCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isDone = block.status === "done";
  const details = extractDetails(block.details);
  const args = parseArgs(block.args);
  const message = (args.message as string) ?? "";
  const delivered = details.delivered;
  const targetSessionId =
    details.targetSessionId ??
    details.sessionId ??
    (args.targetSessionId as string) ??
    (args.sessionId as string) ??
    undefined;

  const { canJump, handleJump } = useJumpToSession(targetSessionId);

  const displayTitle = message ?? t("coordinator.sendTask");

  let badgeText: string | undefined;
  let badgeColor = "text-text-tertiary";
  if (isRunning) {
    badgeText = t("coordinator.sending");
    badgeColor = "text-status-info animate-pulse";
  } else if (isDone) {
    badgeText = delivered ? t("coordinator.delivered") : t("coordinator.sendFailed");
    badgeColor = delivered ? "text-status-success" : "text-status-error";
  }

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return (
    <div
      data-block-id={blockId}
      className="border-x-0 border-t border-b overflow-hidden border-border-secondary/30 bg-surface-dim"
    >
      <ToolCardHeader
        toolName="session_delegate_send"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            {badgeText && <span className={`shrink-0 text-[10px] ${badgeColor}`}>{badgeText}</span>}
          </>
        }
        action={canJump ? <SessionJumpButton onJump={handleJump} /> : undefined}
      />
      {!collapsed && !isRunning && message && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">Message</div>
          <span className="text-[11px] text-status-info/70 italic block">
            {message.slice(0, 500)}
          </span>
        </div>
      )}
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className={TOOL_MARKDOWN_CLASS}>
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});

export const DelegateSyncCard = memo(function DelegateSyncCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const args = parseArgs(block.args);
  const outputDetails = parseOutputAsDetails(block.output);
  const details = { ...outputDetails, ...extractDetails(block.details) };

  const taskText = stringValue(args.task) ?? details.task ?? "";
  const titleText = stringValue(args.title) ?? details.title ?? taskText.slice(0, 60);
  const agentText = agentValue(args);
  const displayTitle = titleText || t("coordinator.syncTask");
  const modelFallback = useSessionTaskModelFallback();

  const matchedSub = useSubagentStore((s) => {
    for (const subs of Object.values(s.subsessionsByParent)) {
      const found = subs.find((sub) => {
        if (details.sessionId && sub.sessionId === details.sessionId) return true;
        if (sub.toolCallId && sub.toolCallId === block.toolCallId) return true;
        if (titleText && sub.description === titleText) return true;
        if (taskText && sub.instruction === taskText) return true;
        return false;
      });
      if (found) return found;
    }
    return null;
  });
  const modelInfo = mergeSessionTaskModelInfo(
    {
      tier: stringValue(args.tier) ?? details.tier,
      model: stringValue(args.model) ?? matchedSub?.model ?? details.model,
      provider: stringValue(args.provider) ?? matchedSub?.provider ?? details.provider,
      thinkingLevel: stringValue(args.thinkingLevel) ?? details.thinkingLevel,
    },
    modelFallback,
  );

  const targetSessionId = details.sessionId ?? matchedSub?.sessionId;
  const { canJump, handleJump } = useJumpToSession(targetSessionId);
  const sessionStatus = useTargetSessionStatus(targetSessionId);
  const subMessages = useChatStore((s) =>
    targetSessionId
      ? (s.messagesBySession?.[targetSessionId] ?? EMPTY_SUBAGENT_MESSAGES)
      : EMPTY_SUBAGENT_MESSAGES,
  );
  const hasCompletedSubagent = Boolean(matchedSub?.completedAt);
  const hasErroredSubagent =
    Boolean(matchedSub?.error) ||
    (typeof matchedSub?.exitCode === "number" && matchedSub.exitCode !== 0);
  const finalText =
    details.finalText ??
    matchedSub?.finalText ??
    (outputContainsOnlySerializedDetails(block.output) ? undefined : block.output);
  const hasFinalText = Boolean(finalText?.trim());
  const hasTerminalDetailStatus =
    details.status === "completed" ||
    details.status === "timeout" ||
    details.status === "error" ||
    details.status === "aborted";
  const isTimeout = details.status === "timeout";
  const isTerminal =
    hasTerminalDetailStatus || hasCompletedSubagent || hasErroredSubagent || hasFinalText;
  const isRunning = block.status === "running" && !isTerminal;
  const isError =
    !isRunning &&
    (block.status === "error" ||
      details.status === "error" ||
      details.status === "aborted" ||
      hasErroredSubagent);
  const isDone = !isRunning && !isError;

  const statusLabel = useMemo(() => {
    if (isRunning) return t("coordinator.running");
    if (details.status === "timeout") return t("coordinator.timeout");
    if (isError) return t("coordinator.error");
    if (details.status === "aborted") return t("coordinator.aborted");
    if (isTerminal) return t("coordinator.completed");
    return sessionStatusLabel(sessionStatus, t) || t("coordinator.completed");
  }, [details.status, isError, isRunning, isTerminal, sessionStatus, t]);

  let badgeColor = "text-text-tertiary";
  if (isRunning) badgeColor = "text-status-info animate-pulse";
  else if (isTimeout) {
    badgeColor = "text-status-warning";
  } else if (isError) {
    badgeColor = "text-status-error";
  } else if (isDone) {
    badgeColor = "text-status-success";
  }

  const errorText = details.error ?? matchedSub?.error;
  const displayAgentName = agentText ?? matchedSub?.agent ?? "build";
  const agents = useAgentStore((s) => s.agents);
  const activityRoundLabels = useMemo(() => createSessionActivityLabels(t), [t]);
  const activityRounds = useMemo(
    () =>
      buildActivityRoundsFromMessages(subMessages, activityRoundLabels, undefined, {
        forceTerminal: isTerminal,
      }),
    [activityRoundLabels, isTerminal, subMessages],
  );
  const sessionMeta = [
    targetSessionId ? `Session ${targetSessionId}` : null,
    displayAgentName ? `Agent ${displayAgentName}` : null,
    typeof details.exitCode === "number" ? `Exit ${details.exitCode}` : null,
    matchedSub?.sessionPath ?? null,
  ].filter((item): item is string => Boolean(item));
  const fullExecutionText = [
    `session_delegate_sync: ${displayTitle}`,
    taskText ? `Task:\n${taskText}` : "",
    finalText ? `Result:\n${finalText}` : "",
    block.output && block.output !== finalText ? `Raw output:\n${block.output}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <SessionTaskCard
      blockId={blockId}
      toolName="session_delegate_sync"
      status={isRunning ? "running" : isTimeout ? "background" : isError ? "error" : "done"}
      title={displayTitle}
      startedAt={block.startedAt}
      endedAt={block.endedAt}
      badge={
        <>
          {renderAgentBadge(displayAgentName, agents)}
          <SessionTaskModelBadges
            tier={modelInfo.tier}
            model={modelInfo.model}
            provider={modelInfo.provider}
            thinkingLevel={modelInfo.thinkingLevel}
          />
          <SessionTaskWorktreeBadge sessionId={targetSessionId} />
          <span className={`shrink-0 text-[10px] ${badgeColor}`}>{statusLabel}</span>
          <CopyButton text={fullExecutionText} size="xs" />
        </>
      }
      action={
        canJump ? <SessionJumpButton onJump={handleJump} title={t("subagent.view")} /> : undefined
      }
      meta={sessionMeta}
      input={taskText ? { label: "Input", text: taskText, copyText: taskText } : undefined}
      activity={{
        title: t("coordinator.activity"),
        rounds: activityRounds,
        live: !isTerminal && (isRunning || (!finalText && isLiveSessionStatus(sessionStatus))),
        labels: activityRoundLabels,
      }}
      result={
        finalText
          ? {
              label: isTimeout ? t("coordinator.recovery") : "Result",
              text: finalText,
              copyText: finalText,
            }
          : undefined
      }
      error={errorText ? { label: "Error", text: errorText } : undefined}
      details={
        block.details !== undefined
          ? { label: "Details", text: tryFormatAsYaml(JSON.stringify(block.details)) }
          : undefined
      }
    />
  );
});

export const DelegateStatusCard = memo(function DelegateStatusCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";

  const task = block.details as
    | { task?: { title?: string; status?: string; sessionId?: string } }
    | undefined;
  const taskTitle = task?.task?.title;
  const taskStatus = task?.task?.status;
  const sessionTaskStatus = asSessionStatus(taskStatus);
  const taskSessionId = task?.task?.sessionId;
  const statusDetail = extractDetails(block.details).detail;
  const hasStatusContent = statusDetail !== undefined || !!block.output;

  const displayTitle = taskTitle
    ? `${t("coordinator.statusCheck")}: ${taskTitle}`
    : t("coordinator.statusCheck");

  let badgeText: string | undefined;
  let badgeColor = "text-text-tertiary";
  if (isRunning) {
    badgeText = t("coordinator.checking");
    badgeColor = "text-status-info animate-pulse";
  } else if (statusDetail?.phase) {
    badgeText = statusDetail.phase;
    badgeColor = isLiveSessionStatus(sessionTaskStatus) ? "text-status-info" : "text-text-tertiary";
  } else if (taskStatus) {
    badgeText = taskStatus;
  }

  const { canJump, handleJump } = useJumpToSession(taskSessionId);
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return (
    <div
      data-block-id={blockId}
      className="border-x-0 border-t border-b overflow-hidden border-border-secondary/30 bg-surface-dim"
    >
      <ToolCardHeader
        toolName="session_delegate_status"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            {badgeText && <span className={`shrink-0 text-[10px] ${badgeColor}`}>{badgeText}</span>}
          </>
        }
        action={canJump ? <SessionJumpButton onJump={handleJump} /> : undefined}
      />
      {!collapsed && !isRunning && hasStatusContent && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          {statusDetail && (
            <div className="mt-2 mb-2 rounded-md border border-border-secondary/40 bg-bg-primary/60 px-2.5 py-2 text-[11px]">
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                {statusDetail.phase && (
                  <>
                    <span className="text-text-tertiary">Phase</span>
                    <span className="font-medium text-text-primary">{statusDetail.phase}</span>
                  </>
                )}
                {statusDetail.waitingType && (
                  <>
                    <span className="text-text-tertiary">Type</span>
                    <span className="font-mono text-text-secondary">
                      {statusDetail.waitingType}
                    </span>
                  </>
                )}
                {statusDetail.lastMessages?.length ? (
                  <>
                    <span className="text-text-tertiary">Recent</span>
                    <div className="space-y-0.5 text-text-secondary">
                      {statusDetail.lastMessages.map((line, index) => (
                        <div key={`${index}-${line}`} className="break-words">
                          {line}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
          {block.output && (
            <>
              <div className="flex items-center justify-between mb-0.5">
                <div className="text-[10px] text-text-tertiary select-none">Output</div>
                <CopyButton text={block.output} size="xs" />
              </div>
              <div className={TOOL_MARKDOWN_CLASS}>
                <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
});

export const DelegateStopCard = memo(function DelegateStopCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isDone = block.status === "done";
  const details = extractDetails(block.details);
  const args = parseArgs(block.args);
  const targetId = (args.sessionId as string) ?? "";
  const ok = details.ok;

  const { canJump, handleJump } = useJumpToSession(targetId || undefined);

  const displayTitle = targetId
    ? `${t("coordinator.stopTask")}: #${targetId.slice(0, 8)}`
    : t("coordinator.stopTask");

  let badgeText: string | undefined;
  let badgeColor = "text-text-tertiary";
  if (isRunning) {
    badgeText = t("coordinator.stopping");
    badgeColor = "text-status-error animate-pulse";
  } else if (isDone) {
    badgeText = ok ? t("coordinator.stopped") : t("coordinator.stopFailed");
    badgeColor = ok ? "text-status-warning" : "text-status-error";
  }

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return (
    <div
      data-block-id={blockId}
      className="border-x-0 border-t border-b overflow-hidden border-border-secondary/30 bg-surface-dim"
    >
      <ToolCardHeader
        toolName="session_delegate_stop"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            {badgeText && <span className={`shrink-0 text-[10px] ${badgeColor}`}>{badgeText}</span>}
          </>
        }
        action={canJump ? <SessionJumpButton onJump={handleJump} /> : undefined}
      />
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className={TOOL_MARKDOWN_CLASS}>
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});

export const DelegateRemoveCard = memo(function DelegateRemoveCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isDone = block.status === "done";
  const details = extractDetails(block.details);
  const args = parseArgs(block.args);
  const targetId = (args.sessionId as string) ?? "";
  const ok = details.ok;

  const { canJump, handleJump } = useJumpToSession(targetId || undefined);

  const displayTitle = targetId
    ? `${t("coordinator.removeTask")}: #${targetId.slice(0, 8)}`
    : t("coordinator.removeTask");

  let badgeText: string | undefined;
  let badgeColor = "text-text-tertiary";
  if (isRunning) {
    badgeText = t("coordinator.removing");
    badgeColor = "text-status-error animate-pulse";
  } else if (isDone) {
    badgeText = ok ? t("coordinator.removed") : t("coordinator.removeFailed");
    badgeColor = ok ? "text-text-tertiary" : "text-status-error";
  }

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return (
    <div
      data-block-id={blockId}
      className="border-x-0 border-t border-b overflow-hidden border-border-secondary/30 bg-surface-dim"
    >
      <ToolCardHeader
        toolName="session_delegate_remove"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            {badgeText && <span className={`shrink-0 text-[10px] ${badgeColor}`}>{badgeText}</span>}
          </>
        }
        action={canJump ? <SessionJumpButton onJump={handleJump} /> : undefined}
      />
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className={TOOL_MARKDOWN_CLASS}>
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});

export const DelegateClearCard = memo(function DelegateClearCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isDone = block.status === "done";
  const removed = (block.details as { removed?: number } | undefined)?.removed ?? 0;

  const displayTitle = t("coordinator.clearStopped");

  let badgeText: string | undefined;
  if (isRunning) {
    badgeText = t("coordinator.clearing");
  } else if (isDone) {
    badgeText = `${removed} ${t("coordinator.cleared")}`;
  }

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return (
    <div
      data-block-id={blockId}
      className="border-x-0 border-t border-b overflow-hidden border-border-secondary/30 bg-surface-dim"
    >
      <ToolCardHeader
        toolName="session_delegate_clear_stopped"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          badgeText ? (
            <span className="shrink-0 text-[10px] text-text-tertiary">{badgeText}</span>
          ) : undefined
        }
      />
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className={TOOL_MARKDOWN_CLASS}>
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});
