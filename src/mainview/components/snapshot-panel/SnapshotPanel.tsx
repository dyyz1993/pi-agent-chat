import { memo, useEffect, useState, useCallback } from "react";
import {
  Camera,
  RefreshCw,
  FilePlus,
  FileEdit,
  FileX,
  File,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSnapshotStore } from "../../stores/use-snapshot-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { PanelHeader } from "../primitives/PanelHeader";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { InlineDiffViewer } from "../chat/tool-renderers/InlineDiffViewer";
import { formatFilePath } from "../../lib/format-path";

const log = createLogger("snapshot");

export function SnapshotPanel() {
  const { t } = useTranslation("snapshot");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const snapshotsBySession = useSnapshotStore((s) => s.snapshotsBySession);
  const fetchSnapshots = useSnapshotStore((s) => s.fetchSnapshots);
  const rollback = useSnapshotStore((s) => s.rollback);
  const unrevert = useSnapshotStore((s) => s.unrevert);
  const pushNotification = useNotificationStore((s) => s.push);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sessionId = activeSessionId ?? "";
  const loading = useSnapshotStore((s) => s.loadingBySession[sessionId] ?? false);
  const snapshots = sessionId ? (snapshotsBySession[sessionId] ?? []) : [];

  useEffect(() => {
    if (sessionId) {
      fetchSnapshots(sessionId);
    }
  }, [sessionId, fetchSnapshots]);

  const toggleExpand = useCallback((snapId: string) => {
    setExpandedId((prev) => (prev === snapId ? null : snapId));
  }, []);

  const handleRollback = useCallback(
    async (snapId: string) => {
      if (!sessionId) return;
      if (!window.confirm(t("confirmRollback"))) {
        return;
      }
      setRollingBackId(snapId);
      try {
        const result = await rollback(sessionId, snapId);
        if (result.ok) {
          pushNotification({ message: t("rollbackSuccess"), level: "info" });
        } else {
          pushNotification({
            message: result.error
              ? t("rollbackFailed", { error: result.error })
              : t("rollbackFailedGeneric"),
            level: "error",
          });
          log.warn("rollback returned not-ok", { sessionId, snapId, error: result.error });
        }
      } catch (err) {
        pushNotification({
          message: t("rollbackFailedGeneric"),
          level: "error",
        });
        log.error("rollback threw", { err: err instanceof Error ? err.message : String(err) });
      } finally {
        setRollingBackId(null);
      }
    },
    [sessionId, rollback, pushNotification, t],
  );

  const handleUnrevert = useCallback(
    async (snapId: string) => {
      if (!sessionId) return;
      if (!window.confirm(t("confirmUnrevert"))) {
        return;
      }
      setRollingBackId(snapId);
      try {
        const result = await unrevert(sessionId, snapId);
        if (result.ok) {
          pushNotification({ message: t("unrevertSuccess"), level: "info" });
        } else {
          pushNotification({
            message: result.error
              ? t("unrevertFailed", { error: result.error })
              : t("unrevertFailedGeneric"),
            level: "error",
          });
          log.warn("unrevert returned not-ok", { sessionId, snapId, error: result.error });
        }
      } catch (err) {
        pushNotification({
          message: t("unrevertFailedGeneric"),
          level: "error",
        });
        log.error("unrevert threw", { err: err instanceof Error ? err.message : String(err) });
      } finally {
        setRollingBackId(null);
      }
    },
    [sessionId, unrevert, pushNotification, t],
  );

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        icon={Camera}
        iconCls="text-text-tertiary"
        title={t("snapshots", { count: snapshots.length })}
        trailing={
          <button
            onClick={() => sessionId && fetchSnapshots(sessionId)}
            disabled={!sessionId || loading}
            className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-30"
            title={t("refresh")}
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {loading && <SkeletonState />}

        {!loading && !sessionId && <EmptyState />}

        {!loading && sessionId && snapshots.length === 0 && <NoDataState />}

        {!loading &&
          snapshots.map((snap, idx) => (
            <SnapshotCard
              key={snap.id}
              snap={snap}
              sessionId={sessionId}
              isExpanded={expandedId === snap.id}
              isRollingBack={rollingBackId === snap.id}
              rollbackDisabled={rollingBackId !== null}
              onToggleExpand={toggleExpand}
              onRollback={handleRollback}
              onUnrevert={handleUnrevert}
              isLatest={idx === 0}
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
            <div className="flex gap-2">
              <div className="h-2 bg-surface-hover dark:bg-surface-code rounded w-12" />
              <div className="h-2 bg-surface-hover dark:bg-surface-code rounded w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation("snapshot");
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <Camera className="w-8 h-8 text-text-secondary dark:text-text-tertiary mb-3" />
      <p className="text-xs text-text-tertiary font-medium">{t("noActiveSession")}</p>
      <p className="text-[10px] text-text-tertiary mt-1 max-w-[200px] leading-relaxed">
        {t("noActiveSessionHint")}
      </p>
    </div>
  );
}

function NoDataState() {
  const { t } = useTranslation("snapshot");
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <Camera className="w-8 h-8 text-text-secondary dark:text-text-tertiary mb-3" />
      <p className="text-xs text-text-tertiary font-medium">{t("noSnapshotsYet")}</p>
      <p className="text-[10px] text-text-tertiary mt-1 max-w-[200px] leading-relaxed">
        {t("noSnapshotsHint")}
      </p>
    </div>
  );
}

interface SnapshotCardProps {
  snap: {
    id: string;
    stepIndex: number;
    timestamp: string;
    diff: { added: string[]; modified: string[]; deleted: string[] };
    files: Record<string, string>;
    rolledBack: boolean;
  };
  sessionId: string;
  isExpanded: boolean;
  isRollingBack: boolean;
  rollbackDisabled: boolean;
  onToggleExpand: (id: string) => void;
  onRollback: (id: string) => void;
  onUnrevert: (id: string) => void;
  isLatest: boolean;
}

const SnapshotCard = memo(function SnapshotCard({
  snap,
  sessionId,
  isExpanded,
  isRollingBack,
  rollbackDisabled,
  onToggleExpand,
  onRollback,
  onUnrevert,
  isLatest,
}: SnapshotCardProps) {
  const { t } = useTranslation("snapshot");

  const addedCount = snap.diff.added.length;
  const modifiedCount = snap.diff.modified.length;
  const deletedCount = snap.diff.deleted.length;
  const totalCount = addedCount + modifiedCount + deletedCount;
  const fileCount = Object.keys(snap.files).length;

  const timeStr = new Date(snap.timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const diffParts: string[] = [];
  if (addedCount) diffParts.push(`+${addedCount}`);
  if (modifiedCount) diffParts.push(`~${modifiedCount}`);
  if (deletedCount) diffParts.push(`-${deletedCount}`);
  const diffStr = diffParts.join(" ");

  return (
    <div
      className={`border-b border-border-secondary/50 dark:border-surface-code/50 transition-colors ${
        snap.rolledBack ? "opacity-60" : ""
      }`}
    >
      <div className="px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <button
              type="button"
              onClick={() => onToggleExpand(snap.id)}
              className="flex items-center gap-1.5 text-left w-full"
            >
              <span className="text-text-tertiary shrink-0">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </span>
              {snap.rolledBack ? (
                <RotateCcw className="w-3 h-3 text-status-warning shrink-0" />
              ) : (
                <Camera className="w-3 h-3 text-semantic-accent shrink-0" />
              )}
              <span className="text-xs text-text-secondary font-medium">
                Step #{snap.stepIndex}
              </span>
              {isLatest && !snap.rolledBack && (
                <span className="text-[9px] bg-semantic-accent/15 text-semantic-accent px-1 py-0.5 rounded font-medium">
                  {t("latest")}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 mt-0.5 ml-6 text-[10px] text-text-tertiary">
              <span>{timeStr}</span>
              {fileCount > 0 && (
                <span className="flex items-center gap-0.5">
                  <File className="w-2.5 h-2.5" />
                  {fileCount}
                </span>
              )}
              {diffStr && (
                <span className="flex items-center gap-1">
                  {addedCount > 0 && <span className="text-status-success">+{addedCount}</span>}
                  {modifiedCount > 0 && (
                    <span className="text-status-warning">~{modifiedCount}</span>
                  )}
                  {deletedCount > 0 && <span className="text-status-error">-{deletedCount}</span>}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {snap.rolledBack ? (
              <ActionBtn
                icon={RefreshCw}
                title={t("cancelRollback")}
                loading={isRollingBack}
                disabled={rollbackDisabled}
                onClick={() => onUnrevert(snap.id)}
                className="text-status-warning hover:text-status-warning"
              />
            ) : (
              <ActionBtn
                icon={RotateCcw}
                title={t("rollbackToSnapshot")}
                loading={isRollingBack}
                disabled={rollbackDisabled}
                onClick={() => onRollback(snap.id)}
              />
            )}
          </div>
        </div>
      </div>

      {isExpanded && totalCount > 0 && (
        <ExpandedFileList
          sessionId={sessionId}
          added={snap.diff.added}
          modified={snap.diff.modified}
          deleted={snap.diff.deleted}
        />
      )}
    </div>
  );
});

interface ExpandedFileListProps {
  sessionId: string;
  added: string[];
  modified: string[];
  deleted: string[];
}

const ExpandedFileList = memo(function ExpandedFileList({
  sessionId,
  added,
  modified,
  deleted,
}: ExpandedFileListProps) {
  const { t } = useTranslation("snapshot");
  const allFiles = [
    ...added.map((f) => ({ path: f, status: "added" as const })),
    ...modified.map((f) => ({ path: f, status: "modified" as const })),
    ...deleted.map((f) => ({ path: f, status: "deleted" as const })),
  ];

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<{
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
  } | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Per-file lazy loading: only fetch diff when user clicks a specific file
  const handleFileClick = useCallback(
    (filePath: string) => {
      if (selectedFile === filePath) {
        setSelectedFile(null);
        setFileDiff(null);
        return;
      }
      setSelectedFile(filePath);
      setFileDiff(null);
      setDiffLoading(true);
      apiClient
        .call("agent.getFileDiff", { sessionId, filePath })
        .then((result) => {
          if (result) {
            setFileDiff({
              path: filePath,
              oldContent: result.oldContent ?? null,
              newContent: result.newContent ?? null,
              unifiedDiff: result.unifiedDiff ?? "",
            });
          }
        })
        .catch((err) => {
          log.warn("getFileDiff failed", { err: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => setDiffLoading(false));
    },
    [sessionId, selectedFile],
  );

  return (
    <div className="border-t border-border-secondary/30 dark:border-surface-dim/30">
      <div className="px-3 py-1 text-[10px] text-text-tertiary font-medium">
        {allFiles.length} {t("filesChanged")}
      </div>

      <div className="px-2 pb-2 space-y-px">
        {allFiles.map((file) => {
          const statusConfig = {
            added: { Icon: FilePlus, color: "text-status-success" },
            modified: { Icon: FileEdit, color: "text-status-warning" },
            deleted: { Icon: FileX, color: "text-status-error" },
          }[file.status];
          const StatusIcon = statusConfig.Icon;
          const isSelected = selectedFile === file.path;

          return (
            <button
              key={file.path}
              type="button"
              onClick={() => handleFileClick(file.path)}
              className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] transition-colors text-left ${
                isSelected
                  ? "bg-semantic-accent/10 text-semantic-accent"
                  : "text-text-tertiary hover:bg-surface-hover/30 dark:hover:bg-surface-dim/30 hover:text-text-secondary"
              }`}
            >
              <StatusIcon className={`w-3 h-3 shrink-0 ${statusConfig.color}`} />
              <span className="truncate" title={file.path}>
                {formatFilePath(file.path)}
              </span>
              {isSelected && diffLoading && (
                <Loader2 className="w-3 h-3 animate-spin shrink-0 ml-auto" />
              )}
            </button>
          );
        })}
      </div>

      {selectedFile && fileDiff && (
        <div className="border-t border-border-secondary/30 dark:border-surface-dim/30">
          <div className="px-3 py-1 text-[10px] text-text-tertiary font-medium flex items-center gap-1">
            <FileEdit className="w-2.5 h-2.5" />
            <span className="truncate">{selectedFile}</span>
          </div>
          {fileDiff.oldContent !== null && fileDiff.newContent !== null ? (
            <div className="px-2 pb-2">
              <InlineDiffViewer
                oldValue={fileDiff.oldContent}
                newValue={fileDiff.newContent}
                maxHeight="192px"
                filePath={fileDiff.path}
              />
            </div>
          ) : (
            <pre className="px-3 pb-2 text-[10px] text-text-tertiary overflow-x-auto whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-relaxed">
              {fileDiff.unifiedDiff}
            </pre>
          )}
        </div>
      )}
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
