import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock, SessionStatus } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";

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
}

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractDetails(detailData: unknown): CoordinatorDetails {
  if (!detailData || typeof detailData !== "object") return {};
  return detailData as CoordinatorDetails;
}

function useJumpToSession(sessionId: string | undefined): {
  canJump: boolean;
  handleJump: () => void;
} {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const canJump = !!sessionId && sessionId !== activeSessionId;

  const handleJump = useCallback(() => {
    if (!sessionId) return;
    setActiveSession(sessionId);
  }, [sessionId, setActiveSession]);

  return { canJump, handleJump };
}

function useTargetSessionStatus(sessionId: string | undefined): SessionStatus | undefined {
  return useSessionStore((s) => (sessionId ? s.sessionStatusMap[sessionId] : undefined));
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

function renderBadge(
  statusLabel: string | undefined,
  isRunning: boolean,
  sessionStatus: SessionStatus | undefined,
  isDone: boolean,
  canJump: boolean,
  handleJump: () => void,
): ReactNode {
  return (
    <>
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
      {isDone && canJump && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleJump();
          }}
          className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/10 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
        </button>
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
  const isDone = block.status === "done";

  const args = parseArgs(block.args);
  const taskText = (args.task as string) ?? "";
  const titleText = (args.title as string) ?? taskText.slice(0, 60);
  const details = extractDetails(block.details);

  const sessionId = details.sessionId;
  const { canJump, handleJump } = useJumpToSession(sessionId);
  const sessionStatus = useTargetSessionStatus(sessionId);

  const displayTitle = titleText || t("coordinator.delegateTask");

  const statusLabel = isDone
    ? sessionStatusLabel(sessionStatus, t) || t("coordinator.dispatched")
    : isRunning
      ? t("coordinator.creating")
      : undefined;

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
      } ${canJump ? "cursor-pointer" : ""}`}
      onClick={canJump ? handleJump : undefined}
    >
      <ToolCardHeader
        toolName="delegate"
        status={toCardStatus(block)}
        description={displayTitle}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        badge={renderBadge(statusLabel, isRunning, sessionStatus, isDone, canJump, handleJump)}
      />
      {!collapsed && !isRunning && taskText && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">Input</div>
          <span className="text-[11px] text-blue-600/70 dark:text-blue-400/70 italic block">
            {taskText.slice(0, 500)}
          </span>
        </div>
      )}
      {!collapsed && !isRunning && block.output && (
        <div className="px-3 pb-2 border-t border-border-secondary/20">
          <div className="text-[10px] text-text-tertiary mb-0.5 select-none">Output</div>
          <div className="text-[11px] text-text-tertiary font-mono whitespace-pre-wrap max-h-36 overflow-y-auto">
            {block.output}
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
      } ${canJump ? "cursor-pointer" : ""}`}
      onClick={canJump ? handleJump : undefined}
    >
      <ToolCardHeader
        toolName="fork"
        status={toCardStatus(block)}
        description={displayTitle}
        badge={renderBadge(statusLabel, isRunning, sessionStatus, isDone, canJump, handleJump)}
      />
    </div>
  );
});
