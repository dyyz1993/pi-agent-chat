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

const STATUS_CONFIG: Record<
  ModifiedFile["status"],
  { icon: typeof FilePlus; label: string; colorClass: string; bgClass: string; badgeClass: string }
> = {
  added: {
    icon: FilePlus,
    label: "A",
    colorClass: "text-status-success",
    bgClass: "hover:bg-status-success/10 dark:hover:bg-status-success/20",
    badgeClass:
      "bg-status-success/15 text-status-success/80 dark:bg-status-success/20 dark:text-status-success",
  },
  modified: {
    icon: FileEdit,
    label: "M",
    colorClass: "text-status-warning",
    bgClass: "hover:bg-status-warning/10 dark:hover:bg-status-warning/20",
    badgeClass:
      "bg-status-warning/15 text-status-warning/80 dark:bg-status-warning/20 dark:text-status-warning",
  },
  deleted: {
    icon: FileMinus,
    label: "D",
    colorClass: "text-status-error",
    bgClass: "hover:bg-status-error/10 dark:hover:bg-status-error/20",
    badgeClass:
      "bg-status-error/15 text-status-error/80 dark:bg-status-error/20 dark:text-status-error",
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
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.split("/").slice(0, -1).join("/");

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm ${config.bgClass} transition-colors`}
      >
        {expanded ? (
          <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${config.colorClass}`} />
        ) : (
          <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${config.colorClass}`} />
        )}
        <Icon className={`w-3.5 h-3.5 shrink-0 ${config.colorClass}`} />
        <span
          className={`truncate font-mono text-xs flex-1 min-w-0 ${config.colorClass}`}
          title={filePath}
        >
          {dirPath ? <span className="opacity-60">{dirPath}/</span> : null}
          <span className="font-semibold">{fileName}</span>
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
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${config.badgeClass}`}
        >
          {config.label}
        </span>
      </button>
      {expanded && (
        <div className="ml-4 sm:ml-8 mr-2 sm:mr-3 mb-2 mt-1">
          {details ? (
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
                <pre className="px-3 py-2 text-xs leading-5 whitespace-pre font-mono max-h-64 overflow-y-auto">
                  {details.split("\n").map((line, i) => {
                    if (line.startsWith("+ ")) {
                      return (
                        <div
                          key={i}
                          className="bg-status-success/15 dark:bg-status-success/20 text-status-success/80 dark:text-status-success"
                        >
                          {line}
                        </div>
                      );
                    }
                    if (line.startsWith("- ")) {
                      return (
                        <div
                          key={i}
                          className="bg-status-error/15 dark:bg-status-error/20 text-status-error/80 dark:text-status-error"
                        >
                          {line}
                        </div>
                      );
                    }
                    if (line === "---") {
                      return (
                        <div
                          key={i}
                          className="text-text-tertiary border-t border-dashed border-border-secondary my-1"
                        />
                      );
                    }
                    return (
                      <div key={i} className="text-text-secondary">
                        {line}
                      </div>
                    );
                  })}
                </pre>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-md bg-surface-dim dark:bg-surface-dim/60 border border-border-secondary">
              <span className="text-xs text-text-tertiary">
                {status === "deleted"
                  ? "文件将被删除"
                  : status === "added"
                    ? "文件将被移除（新建的内容将丢失）"
                    : "文件将恢复到修改前的状态"}
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
    const state = useRollbackStore.getState();
    const currentTarget = state.target;
    if (!currentTarget) return;
    state.setLoading(true);
    try {
      const sessionState = useSessionStore.getState();
      const sessionId = sessionState.activeSessionId;
      if (!sessionId) {
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
        });
        useNotificationStore.getState().push({
          message: "回滚操作被取消",
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
          message: "回滚未生效，消息数量未减少",
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
        message: "回滚操作失败，请重试",
        level: "error",
      });
    } finally {
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
            {preview?.summary?.totalFiles ?? files.length} 文件
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
            <div className="space-y-1 mb-6">
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
