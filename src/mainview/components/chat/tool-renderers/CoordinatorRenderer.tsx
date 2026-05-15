import { memo, useCallback } from "react";
import { ExternalLink, GitFork, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock, SessionStatus } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";

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
  const isError = block.status === "error";

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

  return (
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden transition-colors ${
        isRunning
          ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20"
          : isError
            ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
            : "border-gray-200 dark:border-gray-700/30 bg-gray-50 dark:bg-gray-800/25"
      } ${canJump ? "cursor-pointer" : ""}`}
      onClick={canJump ? handleJump : undefined}
    >
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <UserPlus
          className={`w-3.5 h-3.5 shrink-0 ${
            isRunning
              ? "text-blue-500 dark:text-blue-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : "text-blue-500/70 dark:text-blue-400/60"
          }`}
        />
        <span
          className={`font-medium shrink-0 ${
            isRunning
              ? "text-blue-600 dark:text-blue-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : "text-gray-800 dark:text-gray-300"
          }`}
        >
          {t("coordinator.delegate")}
        </span>

        <span className="min-w-0 text-gray-600 dark:text-gray-400 truncate font-normal">
          {displayTitle}
        </span>

        <span className="flex-1 min-w-0" />

        {statusLabel && (
          <span
            className={`shrink-0 text-[10px] ${
              isRunning
                ? "text-blue-500 dark:text-blue-400 animate-pulse"
                : sessionStatus === "streaming"
                  ? "text-amber-500 dark:text-amber-400"
                  : sessionStatus === "idle"
                    ? "text-gray-400 dark:text-gray-500"
                    : "text-gray-500 dark:text-gray-400"
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
      </div>
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
  const isError = block.status === "error";

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
          : isError
            ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
            : "border-gray-200 dark:border-gray-700/30 bg-gray-50 dark:bg-gray-800/25"
      } ${canJump ? "cursor-pointer" : ""}`}
      onClick={canJump ? handleJump : undefined}
    >
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <GitFork
          className={`w-3.5 h-3.5 shrink-0 ${
            isRunning
              ? "text-blue-500 dark:text-blue-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : "text-blue-500/70 dark:text-blue-400/60"
          }`}
        />
        <span
          className={`font-medium shrink-0 ${
            isRunning
              ? "text-blue-600 dark:text-blue-400"
              : isError
                ? "text-red-500 dark:text-red-400"
                : "text-gray-800 dark:text-gray-300"
          }`}
        >
          {t("coordinator.fork")}
        </span>

        <span className="min-w-0 text-gray-600 dark:text-gray-400 truncate font-normal">
          {displayTitle}
        </span>

        <span className="flex-1 min-w-0" />

        {statusLabel && (
          <span
            className={`shrink-0 text-[10px] ${
              isRunning
                ? "text-blue-500 dark:text-blue-400 animate-pulse"
                : sessionStatus === "streaming"
                  ? "text-amber-500 dark:text-amber-400"
                  : sessionStatus === "idle"
                    ? "text-gray-400 dark:text-gray-500"
                    : "text-gray-500 dark:text-gray-400"
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
      </div>
    </div>
  );
});
