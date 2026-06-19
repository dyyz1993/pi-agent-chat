import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ContentBlock, SessionMeta, SessionStatus } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import {
  useDelegateActivityStore,
  type DelegateActivity,
} from "../../../stores/use-delegate-activity-store";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";
import { useJumpToSession } from "../primitives/useJumpToSession";
import { SessionJumpButton } from "../primitives/SessionJumpButton";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { CopyButton } from "../CopyButton";
import { parseToolArgs } from "../../../utils/parse-tool-args";
import { tryFormatAsYaml } from "../../../../shared/lib/json-to-yaml";
import {
  SessionActivitySummary,
  buildActivityRoundsFromMessages,
  createSessionActivityLabels,
  type SessionActivityRound,
} from "./SessionActivitySummary";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

interface CoordinatorDetails {
  sessionId?: string;
  status?: string;
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
}

function parseArgs(args?: string): Record<string, unknown> {
  return parseToolArgs(args) ?? {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

function basename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.split("/").filter(Boolean).pop() ?? path;
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

function DelegateActivitySummary({
  activity,
  live,
}: {
  activity?: DelegateActivity;
  live: boolean;
}) {
  const { t } = useTranslation("chat");
  const rounds: SessionActivityRound[] =
    activity?.rounds.map((round) => ({
      id: round.id,
      index: round.index,
      status: round.status,
      summary: round.summary,
      tools: round.tools.map((tool) => ({
        id: tool.toolCallId,
        name: tool.toolName,
        status: tool.status,
      })),
    })) ?? [];

  return (
    <SessionActivitySummary
      title={t("coordinator.activity")}
      rounds={rounds}
      live={live}
      labels={createSessionActivityLabels(t)}
    />
  );
}

function renderBadge(
  statusLabel: string | undefined,
  isRunning: boolean,
  sessionStatus: SessionStatus | undefined,
  canJump: boolean,
  handleJump: () => void,
  projectName?: string,
): ReactNode {
  return (
    <>
      {projectName && (
        <span className="shrink-0 max-w-24 truncate px-1.5 py-0.5 rounded text-[10px] bg-semantic-tool/15 text-semantic-tool border border-semantic-tool/20">
          {projectName}
        </span>
      )}
      {statusLabel && (
        <span
          className={`shrink-0 text-[10px] ${
            isRunning
              ? "text-blue-500 dark:text-blue-400 animate-pulse"
              : sessionStatus === "streaming"
                ? "text-amber-500 dark:text-amber-400"
                : "text-text-tertiary"
          }`}
        >
          {statusLabel}
        </span>
      )}
      {canJump && (
        <SessionJumpButton onJump={handleJump} />
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
  const isRunning = block.status === "running";

  const args = parseArgs(block.args);
  const taskText = (args.task as string) ?? "";
  const titleText = (args.title as string) ?? taskText.slice(0, 60);
  const details = extractDetails(block.details);

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
  const { canJump, handleJump } = useJumpToSession(targetSessionId);
  const sessionStatus = useTargetSessionStatus(targetSessionId);
  const activity = useDelegateActivityStore((s) =>
    targetSessionId ? s.bySession[targetSessionId] : undefined,
  );
  const delegateLive = isLiveSessionStatus(sessionStatus) || activity?.status === "running";

  const displayTitle = titleText || t("coordinator.delegateTask");

  const statusLabel =
    sessionStatusLabel(sessionStatus, t) ||
    (matchedSession ? t("coordinator.dispatched") : isRunning ? t("coordinator.creating") : undefined);

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
      className={`border-x-0 border-t border-b overflow-hidden transition-colors ${
        isRunning
          ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20"
          : block.status === "error"
            ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <ToolCardHeader
        toolName="delegate"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={renderBadge(
          statusLabel,
          isRunning,
          sessionStatus,
          canJump,
          handleJump,
          basename(targetProjectPath),
        )}
      />
      {!collapsed && !isRunning && taskText && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">Input</div>
          <span className="text-[11px] text-blue-600/70 dark:text-blue-400/70 italic block">
            {taskText.slice(0, 500)}
          </span>
        </div>
      )}
      {!collapsed && <DelegateActivitySummary activity={activity} live={delegateLive} />}
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
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
  const isRunning = block.status === "running";
  const isDone = block.status === "done";

  const args = parseArgs(block.args);
  const taskText = (args.task as string) ?? "";
  const titleText = (args.title as string) ?? taskText.slice(0, 60);
  const details = extractDetails(block.details);

  const sessionId = details.sessionId;
  const { canJump, handleJump } = useJumpToSession(sessionId);
  const sessionStatus = useTargetSessionStatus(sessionId);

  const displayTitle = titleText || t("coordinator.forkTask");

  const statusLabel = isDone
    ? sessionStatusLabel(sessionStatus, t) || t("coordinator.dispatched")
    : isRunning
      ? t("coordinator.forking")
      : undefined;

  return (
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden transition-colors ${
        isRunning
          ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20"
          : block.status === "error"
            ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <ToolCardHeader
        toolName="fork"
        status={toCardStatus(block)}
        description={displayTitle}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={renderBadge(statusLabel, isRunning, sessionStatus, canJump, handleJump)}
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
            {canJump && (
              <SessionJumpButton onJump={handleJump} />
            )}
          </>
        }
      />
      {!collapsed && !isRunning && message && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">Message</div>
          <span className="text-[11px] text-blue-600/70 dark:text-blue-400/70 italic block">
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
          <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
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
  const isRunning = block.status === "running";
  const isDone = block.status === "done";
  const isError = block.status === "error";
  const args = parseArgs(block.args);
  const outputDetails = parseOutputAsDetails(block.output);
  const details = { ...outputDetails, ...extractDetails(block.details) };

  const taskText = stringValue(args.task) ?? details.task ?? "";
  const titleText = stringValue(args.title) ?? details.title ?? taskText.slice(0, 60);
  const agentText = stringValue(args.agent);
  const displayTitle = titleText || t("coordinator.syncTask");

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

  const targetSessionId = details.sessionId ?? matchedSub?.sessionId;
  const { canJump, handleJump } = useJumpToSession(targetSessionId);
  const sessionStatus = useTargetSessionStatus(targetSessionId);
  const subMessages = useSubagentStore((s) =>
    targetSessionId ? (s.messagesBySubsession?.[targetSessionId] ?? []) : [],
  );

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  const statusLabel = useMemo(() => {
    if (isRunning) return t("coordinator.running");
    if (isError) return t("coordinator.error");
    if (details.status === "timeout") return t("coordinator.timeout");
    if (details.status === "aborted") return t("coordinator.aborted");
    return sessionStatusLabel(sessionStatus, t) || t("coordinator.completed");
  }, [details.status, isError, isRunning, sessionStatus, t]);

  let badgeColor = "text-text-tertiary";
  if (isRunning) badgeColor = "text-status-info animate-pulse";
  else if (isError || details.status === "error" || details.status === "timeout") {
    badgeColor = "text-status-error";
  } else if (isDone) {
    badgeColor = "text-status-success";
  }

  const finalText =
    details.finalText ??
    matchedSub?.finalText ??
    (outputContainsOnlySerializedDetails(block.output) ? undefined : block.output);
  const errorText = details.error ?? matchedSub?.error;
  const activityRoundLabels = useMemo(() => createSessionActivityLabels(t), [t]);
  const activityRounds = useMemo(
    () => buildActivityRoundsFromMessages(subMessages, activityRoundLabels),
    [activityRoundLabels, subMessages],
  );
  const sessionMeta = [
    targetSessionId ? `Session ${targetSessionId}` : null,
    agentText ? `Agent ${agentText}` : null,
    typeof details.exitCode === "number" ? `Exit ${details.exitCode}` : null,
    matchedSub?.sessionPath ? matchedSub.sessionPath : null,
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
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden transition-colors ${
        isRunning
          ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20"
          : isError || details.status === "error" || details.status === "timeout"
            ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <ToolCardHeader
        toolName="session_delegate_sync"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            <span className={`shrink-0 text-[10px] ${badgeColor}`}>{statusLabel}</span>
            {canJump && (
              <SessionJumpButton onJump={handleJump} title={t("subagent.view")} />
            )}
            <CopyButton text={fullExecutionText} size="xs" />
          </>
        }
      />

      {!collapsed && (
        <div className="border-t border-border-secondary/20">
          {sessionMeta.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-text-tertiary flex flex-wrap gap-x-2 gap-y-1 border-b border-border-secondary/20">
              {sessionMeta.map((item) => (
                <span key={item} className="font-mono truncate max-w-full">
                  {item}
                </span>
              ))}
            </div>
          )}

          <SessionActivitySummary
            title={t("coordinator.activity")}
            rounds={activityRounds}
            live={isRunning || isLiveSessionStatus(sessionStatus)}
            labels={activityRoundLabels}
          />

          {taskText && (
            <div className="px-3 py-2 border-b border-border-secondary/20">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-text-tertiary select-none">Input</div>
                <CopyButton text={taskText} size="xs" />
              </div>
              <div className="text-[11px] text-blue-600/80 dark:text-blue-400/80 whitespace-pre-wrap leading-relaxed">
                {taskText}
              </div>
            </div>
          )}

          {finalText && (
            <div className="px-3 py-2 border-b border-border-secondary/20">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] text-text-tertiary select-none">Result</div>
                <CopyButton text={finalText} size="xs" />
              </div>
              <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
                <CachedReactMarkdown>{finalText}</CachedReactMarkdown>
              </div>
            </div>
          )}

          {errorText && (
            <div className="px-3 py-2 border-b border-status-error/20">
              <div className="text-[10px] text-status-error mb-1 select-none">Error</div>
              <pre className="text-[11px] text-status-error/90 whitespace-pre-wrap font-mono">
                {errorText}
              </pre>
            </div>
          )}

          {block.details !== undefined && (
            <details className="group">
              <summary className="px-3 py-1.5 text-[11px] text-text-tertiary cursor-pointer hover:text-text-primary select-none">
                Details
              </summary>
              <pre className="px-3 pb-2 text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono max-h-44 overflow-y-auto">
                {tryFormatAsYaml(JSON.stringify(block.details))}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
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
  const taskSessionId = task?.task?.sessionId;

  const displayTitle = taskTitle
    ? `${t("coordinator.statusCheck")}: ${taskTitle}`
    : t("coordinator.statusCheck");

  let badgeText: string | undefined;
  let badgeColor = "text-text-tertiary";
  if (isRunning) {
    badgeText = t("coordinator.checking");
    badgeColor = "text-status-info animate-pulse";
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
            {canJump && (
              <SessionJumpButton onJump={handleJump} />
            )}
          </>
        }
      />
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
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
            {canJump && (
              <SessionJumpButton onJump={handleJump} />
            )}
          </>
        }
      />
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
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
            {canJump && (
              <SessionJumpButton onJump={handleJump} />
            )}
          </>
        }
      />
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="flex items-center justify-between mb-0.5">
            <div className="text-[10px] text-text-tertiary select-none">Output</div>
            <CopyButton text={block.output} size="xs" />
          </div>
          <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
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
          <div className="text-[11px] text-text-primary prose prose-sm max-w-none max-h-64 overflow-y-auto">
            <CachedReactMarkdown>{block.output}</CachedReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});
