import { memo, useEffect, useCallback, useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChangeReviewStore } from "../../stores/use-change-review-store";
import { useGitStore } from "../../stores/use-git-store";
import { useSessionStore } from "../../stores/use-session-store";
import { apiClient } from "../../lib/api-client";

export function ChangeReviewPanel() {
  const { t } = useTranslation("changeReview");
  const changes = useChangeReviewStore((s) => s.changes);
  const loading = useChangeReviewStore((s) => s.loading);
  const selectedPath = useChangeReviewStore((s) => s.selectedPath);
  const fetchPending = useChangeReviewStore((s) => s.fetchPending);
  const approveAll = useChangeReviewStore((s) => s.approveAll);
  const setSelectedPath = useChangeReviewStore((s) => s.setSelectedPath);

  const pendingCount = useMemo(
    () => changes.filter((c) => c.status === "pending").length,
    [changes],
  );

  // Auto-fetch on mount
  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleApproveAll = useCallback(() => {
    if (pendingCount === 0) return;
    if (!window.confirm(t("approveConfirm", { count: pendingCount }))) return;
    approveAll();
  }, [pendingCount, approveAll, t]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-secondary dark:border-surface-code">
        <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
          <FileText className="w-3.5 h-3.5" />
          <span>{t("title")}</span>
          {pendingCount > 0 && (
            <span className="bg-status-warning/20 text-status-warning text-[10px] px-1.5 py-0.5 rounded-full font-medium">
              {pendingCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchPending}
            disabled={loading}
            className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30"
            title={t("refresh")}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={handleApproveAll}
            disabled={pendingCount === 0}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-semantic-accent/15 text-semantic-accent hover:bg-semantic-accent/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t("approveAll")}
          >
            <CheckSquare className="w-3 h-3" />
            {t("approveAll")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && changes.length === 0 && <SkeletonState />}

        {!loading && changes.length === 0 && <EmptyState />}

        {changes.map((change) => (
          <ChangeItem
            key={`${change.turnIndex}-${change.path}`}
            change={change}
            isExpanded={selectedPath === `${change.turnIndex}:${change.path}`}
            onToggle={() =>
              setSelectedPath(
                selectedPath === `${change.turnIndex}:${change.path}`
                  ? null
                  : `${change.turnIndex}:${change.path}`,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}

function SkeletonState() {
  return (
    <div className="px-3 py-4 space-y-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="w-3 h-3 rounded bg-surface-hover shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 bg-surface-hover rounded w-1/3" />
            <div className="h-2.5 bg-surface-hover dark:bg-surface-code rounded w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation("changeReview");
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <CheckCircle2 className="w-8 h-8 text-text-secondary dark:text-text-tertiary mb-3" />
      <p className="text-xs text-text-tertiary font-medium">{t("noChanges")}</p>
    </div>
  );
}

const STATUS_CONFIG = {
  pending: {
    Icon: Clock,
    color: "text-status-warning",
    bg: "bg-status-warning/15",
  },
  approved: {
    Icon: CheckCircle2,
    color: "text-status-success",
    bg: "bg-status-success/15",
  },
  rejected: {
    Icon: XCircle,
    color: "text-status-error",
    bg: "bg-status-error/15",
  },
} as const;

interface ChangeItemProps {
  change: {
    turnIndex: number;
    path: string;
    status: "pending" | "approved" | "rejected";
    timestamp: number;
  };
  isExpanded: boolean;
  onToggle: () => void;
}

const ChangeItem = memo(function ChangeItem({ change, isExpanded, onToggle }: ChangeItemProps) {
  const { t } = useTranslation("changeReview");
  const approveChange = useChangeReviewStore((s) => s.approveChange);
  const rejectChange = useChangeReviewStore((s) => s.rejectChange);

  const statusCfg = STATUS_CONFIG[change.status];
  const StatusIcon = statusCfg.Icon;
  const timeStr = new Date(change.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleApprove = useCallback(() => {
    approveChange(change.turnIndex, change.path);
  }, [approveChange, change.turnIndex, change.path]);

  const handleReject = useCallback(() => {
    rejectChange(change.turnIndex, change.path);
  }, [rejectChange, change.turnIndex, change.path]);

  const handleViewDiff = useCallback(async () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    try {
      const result = await apiClient.call("agent.getBatchDiffs", { sessionId });
      const match = result?.files?.find((f: { path: string }) => f.path === change.path);
      if (match?.diff) {
        useGitStore.setState({
          currentDiff: {
            filePath: change.path,
            diff: match.diff.unifiedDiff,
            oldContent: match.diff.oldContent ?? "",
            newContent: match.diff.newContent ?? "",
          },
        });
      }
    } catch {
      // Silently fail — user can retry
    }
  }, [change.path]);

  return (
    <div className="border-b border-border-secondary/50 dark:border-surface-code/50">
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-start gap-1.5 text-left flex-1 min-w-0"
          >
            <span className="text-text-tertiary shrink-0 mt-0.5">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <span
                className="text-[11px] font-mono text-semantic-accent hover:underline cursor-pointer truncate block"
                title={change.path}
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewDiff();
                }}
              >
                {change.path}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-text-tertiary">
                  {t("turn", { index: change.turnIndex })}
                </span>
                <span className="text-[10px] text-text-tertiary">{timeStr}</span>
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${statusCfg.bg} ${statusCfg.color}`}
            >
              <StatusIcon className="w-2.5 h-2.5" />
              {t(change.status)}
            </span>
            {change.status === "pending" && (
              <>
                <ActionBtn
                  icon={CheckCircle2}
                  title={t("approve")}
                  onClick={handleApprove}
                  className="text-status-success hover:text-status-success"
                />
                <ActionBtn
                  icon={XCircle}
                  title={t("reject")}
                  onClick={handleReject}
                  className="text-status-error hover:text-status-error"
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

interface ActionBtnProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}

const ActionBtn = memo(function ActionBtn({
  icon: Icon,
  title,
  loading,
  disabled,
  onClick,
  className,
}: ActionBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        className ??
        "text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover"
      }`}
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
    </button>
  );
});
