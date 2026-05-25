import { memo, useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  X,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRollbackStore } from "../../stores/use-rollback-store";
import type { ModifiedFile } from "../../stores/use-rollback-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("chat");

const FILE_STATUS_CONFIG: Record<
  ModifiedFile["status"],
  { icon: typeof FilePlus; label: string; color: string; bg: string }
> = {
  added: {
    icon: FilePlus,
    label: "A",
    color: "text-status-success",
    bg: "bg-status-success/10",
  },
  modified: {
    icon: FileEdit,
    label: "M",
    color: "text-status-warning",
    bg: "bg-status-warning/10",
  },
  deleted: {
    icon: FileMinus,
    label: "D",
    color: "text-status-error",
    bg: "bg-status-error/10",
  },
};

interface FileItemProps {
  filePath: string;
  status: ModifiedFile["status"];
  details?: string;
  addedLines?: number;
  removedLines?: number;
  expanded: boolean;
  onToggle: () => void;
}

const FileItem = memo(function FileItem({
  filePath,
  status,
  details,
  addedLines,
  removedLines,
  expanded,
  onToggle,
}: FileItemProps) {
  const { t } = useTranslation("chat");
  const config = FILE_STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className="border-b border-border-secondary/50 dark:border-surface-code/50">
      <div className="px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-start gap-1.5 text-left w-full"
        >
          <span className="text-text-tertiary shrink-0 mt-0.5">
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={`shrink-0 ${config.color}`}>
                <Icon className="w-3 h-3" />
              </span>
              <span
                className="text-[11px] font-mono text-semantic-accent truncate"
                title={filePath}
              >
                {filePath}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`px-1 rounded text-[10px] font-medium ${config.color} ${config.bg}`}>
                {config.label}
              </span>
              {(addedLines !== undefined || removedLines !== undefined) && (
                <span className="flex items-center gap-0.5 text-[10px] font-mono">
                  {removedLines !== undefined && removedLines > 0 && (
                    <span className="text-status-error">-{removedLines}</span>
                  )}
                  {addedLines !== undefined && addedLines > 0 && (
                    <span className="text-status-success">+{addedLines}</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-2 ml-4">
          {details != null ? (
            <div className="rounded-md bg-surface-dim dark:bg-surface-dim/60 border border-border-secondary overflow-hidden">
              <div className="px-3 py-1.5 bg-surface-hover/50 border-b border-border-secondary flex items-center gap-2">
                <span className="text-[10px] text-text-tertiary font-mono truncate">
                  {filePath}
                </span>
                {(addedLines !== undefined || removedLines !== undefined) && (
                  <span className="shrink-0 flex items-center gap-1 text-[10px] font-mono">
                    {removedLines !== undefined && removedLines > 0 && (
                      <span className="text-status-error">-{removedLines}</span>
                    )}
                    {addedLines !== undefined && addedLines > 0 && (
                      <span className="text-status-success">+{addedLines}</span>
                    )}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto overscroll-contain">
                <pre className="px-3 py-2 text-xs leading-5 whitespace-pre font-mono max-h-64 overflow-y-auto text-text-secondary">
                  {details}
                </pre>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-md bg-surface-dim dark:bg-surface-dim/60 border border-border-secondary">
              <span className="text-xs text-text-tertiary">
                {status === "deleted"
                  ? t("rollbackOverlay.fileWillBeDeleted")
                  : status === "added"
                    ? t("rollbackOverlay.fileWillBeRemoved")
                    : t("rollbackOverlay.fileWillBeRestored")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const RollbackOverlay = memo(function RollbackOverlay() {
  const { t } = useTranslation("chat");
  const open = useRollbackStore((s) => s.open);
  const target = useRollbackStore((s) => s.target);
  const preview = useRollbackStore((s) => s.preview);
  const loading = useRollbackStore((s) => s.loading);
  const closeRollback = useRollbackStore((s) => s.closeRollback);
  const containerRef = useRef<HTMLDivElement>(null);
  const confirmingRef = useRef(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  useFocusTrap(containerRef, { onEscape: closeRollback });

  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const confirmRollback = useCallback(async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    const state = useRollbackStore.getState();
    const currentTarget = state.target;
    if (!currentTarget) {
      confirmingRef.current = false;
      return;
    }
    state.setLoading(true);
    try {
      const sessionState = useSessionStore.getState();
      const sessionId = sessionState.activeSessionId;
      if (!sessionId) {
        state.closeRollback();
        return;
      }

      const sessionStatus = useSessionStore.getState().sessionStatusMap[sessionId];
      if (
        sessionStatus === "streaming" ||
        sessionStatus === "compacting" ||
        sessionStatus === "retrying"
      ) {
        useNotificationStore.getState().push({
          message: "Cannot rollback while agent is streaming",
          level: "warning",
        });
        state.closeRollback();
        return;
      }

      const beforeCount = useChatStore.getState().messagesBySession[sessionId]?.length ?? 0;
      const tab = sessionState.projectTabs.find((t) => t.id === sessionState.activeProjectId);
      let sessionPath: string | undefined;
      if (tab) {
        const sessions = sessionState.sessionsByProject[tab.path];
        const session = sessions?.find((s) => s.sessionId === sessionId);
        sessionPath = session?.sessionPath;
      }

      const skipFiles = currentTarget.mode === "message";
      const result = await apiClient.call("agent.navigateTree", {
        sessionId,
        targetId: currentTarget.targetId,
        summarize: false,
        skipFiles,
      });

      if (result.cancelled) {
        log.warn("rollback cancelled by backend", {
          sessionId,
          targetId: currentTarget.targetId,
          reason: result.reason,
        });
        useNotificationStore.getState().push({
          message: result.reason
            ? t("rollbackOverlay.rollbackCancelledReason", { reason: result.reason })
            : t("rollbackOverlay.rollbackCancelled"),
          level: "warning",
        });
        return;
      }

      await useChatStore.getState().loadSessionMessages(sessionId, { force: true, sessionPath });

      const afterCount = useChatStore.getState().messagesBySession[sessionId]?.length ?? 0;

      if (afterCount >= beforeCount && beforeCount > 0) {
        log.warn("rollback appears ineffective", {
          sessionId,
          beforeCount,
          afterCount,
          targetId: currentTarget.targetId,
        });
        useNotificationStore.getState().push({
          message: t("rollbackOverlay.rollbackIneffective"),
          level: "warning",
        });
      } else {
        log.info("rollback executed from overlay", {
          sessionId,
          mode: currentTarget.mode,
          targetId: currentTarget.targetId,
          beforeCount,
          afterCount,
        });
      }
    } catch (err) {
      log.error("rollback failed from overlay", {
        err: err instanceof Error ? err.message : String(err),
      });
      useNotificationStore.getState().push({
        message: t("rollbackOverlay.rollbackFailed"),
        level: "error",
      });
    } finally {
      confirmingRef.current = false;
      useRollbackStore.getState().closeRollback();
    }
  }, []);

  if (!open || !target) return null;

  const isWithFiles = target.mode === "withFiles";
  const files = preview?.files ?? [];
  const hasFiles = files.length > 0;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-bg-elevated/98 dark:bg-surface-code/98 backdrop-blur-sm overflow-hidden"
    >
      <div
        className="flex items-center gap-2 px-4 py-2 bg-surface-dim/90 dark:bg-surface-code/90 border-b border-border-secondary flex-shrink-0"
        style={{
          paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))",
        }}
      >
        <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">
          {isWithFiles ? t("rollbackOverlay.titleWithFiles") : t("rollbackOverlay.title")}
        </span>
        {hasFiles && (
          <span className="text-xs text-text-tertiary">
            {t("rollbackOverlay.fileCount", {
              count: preview?.summary?.totalFiles ?? files.length,
            })}
          </span>
        )}
        <button
          type="button"
          onClick={closeRollback}
          className="p-2 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
          title={t("rollbackOverlay.cancel")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-2xl w-full mx-auto px-4 sm:px-6 py-6">
          <p className="text-sm text-text-secondary dark:text-text-tertiary mb-4">
            {isWithFiles
              ? t("rollbackOverlay.withFilesModeDesc")
              : t("rollbackOverlay.messageModeDesc")}
          </p>

          {isWithFiles && hasFiles && (
            <div className="mb-6">
              {files.map((file) => (
                <FileItem
                  key={`${file.status}-${file.path}`}
                  filePath={file.path}
                  status={file.status}
                  details={file.details}
                  addedLines={file.addedLines}
                  removedLines={file.removedLines}
                  expanded={expandedFiles.has(`${file.status}-${file.path}`)}
                  onToggle={() => toggleFile(`${file.status}-${file.path}`)}
                />
              ))}
            </div>
          )}

          {isWithFiles && !hasFiles && (
            <p className="text-xs text-text-tertiary mb-6">{t("rollbackOverlay.noFiles")}</p>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 flex-wrap">
            <button
              type="button"
              onClick={closeRollback}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg border border-border-secondary text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("rollbackOverlay.cancel")}
            </button>
            <button
              type="button"
              onClick={confirmRollback}
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-status-error hover:bg-status-error/80 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {t("rollbackOverlay.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
