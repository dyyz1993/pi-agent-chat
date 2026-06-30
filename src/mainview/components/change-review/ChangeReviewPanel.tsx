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
  Plus,
  Minus,
  Pencil,
  XSquare,
  Bot,
  ArrowRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChangeReviewStore } from "../../stores/use-change-review-store";
import { useGitStore } from "../../stores/use-git-store";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { PanelHeader } from "../primitives/PanelHeader";
import type { FileStatus } from "../../../shared/modules/change-review";
import { InlineDiffViewer } from "../chat/tool-renderers/InlineDiffViewer";
import type { ChildReviewSummary } from "../../stores/use-change-review-store";

/* ── Git-style status helpers (reusing GitPanel patterns) ── */

const FILE_STATUS_CONFIG: Record<
  FileStatus,
  { Icon: typeof Plus; label: string; color: string; bg: string }
> = {
  added: { Icon: Plus, label: "A", color: "text-status-success", bg: "bg-status-success/10" },
  modified: { Icon: Pencil, label: "M", color: "text-status-warning", bg: "bg-status-warning/10" },
  deleted: { Icon: Minus, label: "D", color: "text-status-error", bg: "bg-status-error/10" },
};

export function ChangeReviewPanel() {
  const { t } = useTranslation("changeReview");
  const changes = useChangeReviewStore((s) => s.changes);
  const loading = useChangeReviewStore((s) => s.loading);
  const childReviewLoading = useChangeReviewStore((s) => s.childReviewLoading);
  const childReviewSummaries = useChangeReviewStore((s) => s.childReviewSummaries);
  const selectedPath = useChangeReviewStore((s) => s.selectedPath);
  const fetchPending = useChangeReviewStore((s) => s.fetchPending);
  const fetchChildReviewSummaries = useChangeReviewStore((s) => s.fetchChildReviewSummaries);
  const approveAll = useChangeReviewStore((s) => s.approveAll);
  const rejectAll = useChangeReviewStore((s) => s.rejectAll);
  const setSelectedPath = useChangeReviewStore((s) => s.setSelectedPath);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSubsessionId = useSubagentStore((s) => s.activeSubsessionId);
  const isViewingSubtask = Boolean(activeSubsessionId);

  const pendingCount = useMemo(
    () => changes.filter((c) => c.status === "pending").length,
    [changes],
  );

  // Auto-fetch on mount
  useEffect(() => {
    fetchPending();
    if (activeSessionId && !isViewingSubtask) {
      void fetchChildReviewSummaries(activeSessionId);
    }
  }, [activeSessionId, fetchChildReviewSummaries, fetchPending, isViewingSubtask]);

  const handleApproveAll = useCallback(() => {
    if (pendingCount === 0) return;
    approveAll();
  }, [pendingCount, approveAll, t]);

  const handleRefresh = useCallback(() => {
    void fetchPending();
    if (activeSessionId && !isViewingSubtask) {
      void fetchChildReviewSummaries(activeSessionId);
    }
  }, [activeSessionId, fetchChildReviewSummaries, fetchPending, isViewingSubtask]);

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        icon={FileText}
        iconCls="text-text-tertiary"
        title={
          <>
            {t("title")}
            {pendingCount > 0 && (
              <span className="bg-status-warning/20 text-status-warning text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                {pendingCount}
              </span>
            )}
          </>
        }
        trailing={
          <>
            <button
              onClick={handleRefresh}
              disabled={loading || childReviewLoading}
              className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary transition-colors disabled:opacity-30"
              title={t("refresh")}
            >
              <RefreshCw
                className={`w-3 h-3 ${loading || childReviewLoading ? "animate-spin" : ""}`}
              />
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
            <button
              onClick={rejectAll}
              disabled={pendingCount === 0}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-status-error/15 text-status-error hover:bg-status-error/25 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={t("rejectAll")}
            >
              <XSquare className="w-3 h-3" />
              {t("rejectAll")}
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {loading && changes.length === 0 && <SkeletonState />}

        {!isViewingSubtask && childReviewSummaries.length > 0 && (
          <ChildReviewSection summaries={childReviewSummaries} />
        )}

        {!loading && changes.length === 0 && childReviewSummaries.length === 0 && <EmptyState />}

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

function ChildReviewSection({ summaries }: { summaries: ChildReviewSummary[] }) {
  const { t } = useTranslation("changeReview");
  return (
    <div className="border-b border-border-secondary/60 bg-status-warning/5 px-2 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-status-warning">
        <Bot className="h-3 w-3" />
        {t("subtaskReview.title", "子任务待审批")}
      </div>
      <div className="space-y-1.5">
        {summaries.map((summary) => (
          <ChildReviewEntry key={summary.subSessionId} summary={summary} />
        ))}
      </div>
    </div>
  );
}

function ChildReviewEntry({ summary }: { summary: ChildReviewSummary }) {
  const { t } = useTranslation("changeReview");
  const fetchPending = useChangeReviewStore((s) => s.fetchPending);
  const setSelectedPath = useChangeReviewStore((s) => s.setSelectedPath);

  const handleOpen = useCallback(() => {
    useSessionStore.getState().setActiveSession(summary.parentSessionId, true);
    useSubagentStore.getState().setActiveSubsession(summary.parentSessionId, summary.subSessionId);
    setSelectedPath(null);
    void fetchPending(summary.subSessionId);
  }, [fetchPending, setSelectedPath, summary.parentSessionId, summary.subSessionId]);

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="group flex w-full items-center gap-2 rounded-lg border border-status-warning/20 bg-bg-primary/75 px-2.5 py-2 text-left transition-colors hover:border-status-warning/45 hover:bg-status-warning/10"
      title={`${summary.title} · ${summary.subSessionId}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-status-warning/15 text-status-warning">
        <Bot className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium text-text-primary">
          {summary.title}
        </span>
        <span className="block truncate text-[10px] text-text-tertiary">
          {t("subtaskReview.pendingCount", "{{count}} 个文件待审批", {
            count: summary.pendingCount,
          })}
        </span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-status-warning" />
    </button>
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
    fileStatus: FileStatus;
    status: "pending" | "approved" | "rejected";
    timestamp: number;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff?: string;
    snapshotEntryId?: string;
    addedLines?: number;
    deletedLines?: number;
  };
  isExpanded: boolean;
  onToggle: () => void;
}

const ChangeItem = memo(function ChangeItem({ change, isExpanded, onToggle }: ChangeItemProps) {
  const { t } = useTranslation("changeReview");
  const approveChange = useChangeReviewStore((s) => s.approveChange);
  const rejectChange = useChangeReviewStore((s) => s.rejectChange);
  const isProcessing = useChangeReviewStore((s) => s.processingPaths.has(change.path));

  const statusCfg = STATUS_CONFIG[change.status];
  const StatusIcon = statusCfg.Icon;
  const fileCfg = FILE_STATUS_CONFIG[change.fileStatus];
  const FileStatusIcon = fileCfg.Icon;
  const hasDiffData =
    change.oldContent !== null || change.newContent !== null || !!change.unifiedDiff?.trim();

  const stats = useMemo(() => {
    if (change.addedLines != null || change.deletedLines != null) {
      return { additions: change.addedLines ?? 0, deletions: change.deletedLines ?? 0 };
    }
    return null;
  }, [change.addedLines, change.deletedLines]);

  const handleApprove = useCallback(() => {
    approveChange(change.path);
  }, [approveChange, change.path]);

  const handleReject = useCallback(() => {
    rejectChange(change.path);
  }, [rejectChange, change.path]);

  const handleViewDiff = useCallback(() => {
    if (!hasDiffData) return;
    // Use change-review data directly (correct baseline from review.pending channel)
    // instead of fetchAgentFileDiff (which uses a different default baseline)
    useGitStore.setState({
      currentDiff: {
        filePath: change.path,
        diff: "",
        oldContent: change.oldContent ?? "",
        newContent: change.newContent ?? "",
      },
      loadingDiff: false,
    });
    useChatOverlayStore.getState().openDiff();
  }, [change.path, change.oldContent, change.newContent, hasDiffData]);

  const fileName = change.path.split("/").pop() ?? change.path;
  const dirPath = (() => {
    const parts = change.path.split("/");
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  })();

  return (
    <div className="border-b border-border-secondary/50 dark:border-surface-code/50 hover:bg-surface-hover/40 dark:hover:bg-surface-hover/20 transition-colors">
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={onToggle}
            className={`text-text-tertiary shrink-0 ${hasDiffData ? "" : "opacity-40 cursor-default"}`}
            disabled={!hasDiffData}
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>

          <span className={`shrink-0 ${fileCfg.color}`}>
            <FileStatusIcon className="w-3.5 h-3.5" />
          </span>

          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span
              className="text-[11px] font-mono font-medium text-text-primary dark:text-text-secondary hover:underline cursor-pointer truncate"
              title={change.path}
              onClick={hasDiffData ? handleViewDiff : undefined}
            >
              {fileName}
            </span>
            {dirPath && (
              <span className="text-[10px] text-text-tertiary truncate" title={dirPath}>
                {dirPath}
              </span>
            )}
          </div>

          <span className="flex items-center gap-1 text-[10px] font-mono shrink-0">
            {stats && stats.additions > 0 && (
              <span className="text-status-success">+{stats.additions}</span>
            )}
            {stats && stats.deletions > 0 && (
              <span className="text-status-error">-{stats.deletions}</span>
            )}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            {change.status === "pending" && (
              <>
                <ActionBtn
                  icon={CheckCircle2}
                  title={t("approve")}
                  onClick={handleApprove}
                  loading={isProcessing}
                  disabled={isProcessing}
                  className="text-status-success hover:text-status-success"
                />
                <ActionBtn
                  icon={XCircle}
                  title={t("reject")}
                  onClick={handleReject}
                  loading={isProcessing}
                  disabled={isProcessing}
                  className="text-status-error hover:text-status-error"
                />
              </>
            )}
            {change.status !== "pending" && (
              <span
                className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded ${statusCfg.bg} ${statusCfg.color}`}
              >
                <StatusIcon className="w-2.5 h-2.5" />
                {t(change.status)}
              </span>
            )}
          </div>
        </div>

        {isExpanded && hasDiffData && (
          <div className="mt-1">
            <InlineDiffViewer
              oldValue={change.oldContent ?? ""}
              newValue={change.newContent ?? ""}
              filePath={change.path}
              maxHeight="300px"
            />
          </div>
        )}
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
