import { memo, useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronRight,
  ChevronDown,
  Rows3,
  Columns2,
  Maximize2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRollbackStore } from "../../stores/use-rollback-store";
import type { ModifiedFile } from "../../stores/use-rollback-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useActiveSessionActionGuard } from "../../hooks/use-active-session-action-guard";
import { apiClient } from "../../lib/api-client";
import { createLogger } from "../../../shared/lib/logger";
import { InlineDiffViewer } from "./tool-renderers/InlineDiffViewer";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { formatFilePath } from "../../lib/format-path";
import { Button, ModalDialog } from "../primitives";

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
  oldContent?: string | null;
  newContent?: string | null;
  addedLines?: number;
  removedLines?: number;
  expanded: boolean;
  onToggle: () => void;
}

const FileItem = memo(function FileItem({
  filePath,
  status,
  details,
  oldContent,
  newContent,
  addedLines,
  removedLines,
  expanded,
  onToggle,
}: FileItemProps) {
  const { t } = useTranslation("chat");
  const config = FILE_STATUS_CONFIG[status];
  const Icon = config.icon;

  const [splitView, setSplitView] = useState(false);

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
                className="text-[11px] font-mono text-accent truncate"
                title={filePath}
              >
                {formatFilePath(filePath)}
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
          {details != null && (oldContent != null || newContent != null) ? (
            <div className="rounded-md bg-surface-dim dark:bg-surface-dim/60 border border-border-secondary overflow-hidden">
              <div className="px-3 py-1.5 bg-surface-hover/50 border-b border-border-secondary flex items-center gap-2">
                <span
                  className="text-[10px] text-text-tertiary font-mono truncate"
                  title={filePath}
                >
                  {formatFilePath(filePath)}
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
                <div className="shrink-0 flex items-center gap-0.5 ml-1">
                  <button
                    type="button"
                    onClick={() => setSplitView(false)}
                    className={`p-1 rounded transition-colors ${
                      !splitView
                        ? "bg-text-tertiary dark:bg-text-secondary text-white"
                        : "text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"
                    }`}
                    title={t("diffLineByLine", { defaultValue: "Line by line" })}
                    aria-label={t("diffLineByLine", { defaultValue: "Line by line" })}
                  >
                    <Rows3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitView(true)}
                    className={`p-1 rounded transition-colors ${
                      splitView
                        ? "bg-text-tertiary dark:bg-text-secondary text-white"
                        : "text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"
                    }`}
                    title={t("diffSideBySide", { defaultValue: "Side by side" })}
                    aria-label={t("diffSideBySide", { defaultValue: "Side by side" })}
                  >
                    <Columns2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      useChatOverlayStore
                        .getState()
                        .openExpand(
                          filePath.split("/").pop() ?? "Diff",
                          <InlineDiffViewer
                            oldValue={newContent ?? ""}
                            newValue={oldContent ?? ""}
                            splitView={splitView}
                            expandable={false}
                            filePath={filePath}
                            maxHeight="100%"
                          />,
                        )
                    }
                    className="p-1 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover transition-colors"
                    title={t("expand", { defaultValue: "Expand" })}
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <InlineDiffViewer
                oldValue={newContent ?? ""}
                newValue={oldContent ?? ""}
                maxHeight="256px"
                splitView={splitView}
                expandable={false}
                filePath={filePath}
              />
            </div>
          ) : details != null ? (
            <div className="rounded-md bg-surface-dim dark:bg-surface-dim/60 border border-border-secondary overflow-hidden">
              <div className="px-3 py-1.5 bg-surface-hover/50 border-b border-border-secondary flex items-center gap-2">
                <span
                  className="text-[10px] text-text-tertiary font-mono truncate"
                  title={filePath}
                >
                  {formatFilePath(filePath)}
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
                  ? t("rollbackOverlay.fileWillBeRestored")
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
  const activeSessionGuard = useActiveSessionActionGuard({ requireReady: false });
  const confirmingRef = useRef(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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

      const guardedSessionId = activeSessionGuard.guard({
        requireReady: currentTarget.mode === "withFiles",
        readyMessage: t("messageCard.rollbackRequiresActiveSession", {
          defaultValue: "File rollback requires an active session. Please wait for reconnect.",
        }),
      });
      if (!guardedSessionId) {
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
  }, [activeSessionGuard, t]);

  if (!open || !target) return null;

  const isWithFiles = target.mode === "withFiles";
  const files = preview?.files ?? [];
  const hasFiles = files.length > 0;

  return (
    <ModalDialog
      title={isWithFiles ? t("rollbackOverlay.titleWithFiles") : t("rollbackOverlay.title")}
      icon={<AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />}
      onClose={closeRollback}
      closeLabel={t("rollbackOverlay.cancel")}
      size="md"
      data-testid="rollback-overlay"
      className="bg-bg-primary dark:bg-surface-code"
      style={{ maxHeight: "min(80vh, 560px)" }}
      headerClassName="py-2"
      bodyClassName="overscroll-contain"
      footer={
        <>
          <Button size="md" variant="secondary" onClick={closeRollback} disabled={loading}>
            {t("rollbackOverlay.cancel")}
          </Button>
          <Button size="md" variant="danger" onClick={confirmRollback} loading={loading}>
            {t("rollbackOverlay.confirm")}
          </Button>
        </>
      }
    >
      <div className="px-4 py-4">
        {hasFiles && (
          <div className="mb-3 text-xs text-text-tertiary">
            {t("rollbackOverlay.fileCount", {
              count: preview?.summary?.totalFiles ?? files.length,
            })}
          </div>
        )}

        <p className="text-sm text-text-secondary dark:text-text-tertiary mb-4">
          {isWithFiles
            ? t("rollbackOverlay.withFilesModeDesc")
            : t("rollbackOverlay.messageModeDesc")}
        </p>

        {isWithFiles && hasFiles && (
          <div className="mb-4 border border-border-secondary rounded-lg overflow-hidden">
            {files.map((file) => (
              <FileItem
                key={`${file.status}-${file.path}`}
                filePath={file.path}
                status={file.status}
                details={file.details}
                oldContent={file.oldContent}
                newContent={file.newContent}
                addedLines={file.addedLines}
                removedLines={file.removedLines}
                expanded={expandedFiles.has(`${file.status}-${file.path}`)}
                onToggle={() => toggleFile(`${file.status}-${file.path}`)}
              />
            ))}
          </div>
        )}

        {isWithFiles && !hasFiles && (
          <p className="text-xs text-text-tertiary mb-4">{t("rollbackOverlay.noFiles")}</p>
        )}
      </div>
    </ModalDialog>
  );
});
