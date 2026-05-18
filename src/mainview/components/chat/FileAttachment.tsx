import { useRef, useCallback } from "react";
import { Paperclip, ImageIcon, X, Loader2, AlertCircle, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAttachmentStore, type AttachmentFile } from "../../stores/use-attachment-store";
import { formatFileSize } from "../chat/preview/types";
import { useSupervisorStore } from "../../stores/use-supervisor-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useLayoutStore } from "../../layouts/use-layout-store";

function AttachmentPreview({ att, onRemove }: { att: AttachmentFile; onRemove: () => void }) {
  const isImage = att.type.startsWith("image/");

  return (
    <div className="group relative flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-dim dark:bg-surface-dim border border-border-secondary/50 dark:border-border-secondary/50 max-w-[200px]">
      {att.status === "uploading" && (
        <Loader2 className="w-3 h-3 text-semantic-accent animate-spin shrink-0" />
      )}
      {att.status === "error" && <AlertCircle className="w-3 h-3 text-status-error shrink-0" />}
      {att.status === "done" && (
        <div className="w-3 h-3 rounded-full bg-status-success/80 shrink-0" />
      )}
      {att.status === "pending" && (
        <div className="w-3 h-3 rounded-full bg-text-secondary shrink-0" />
      )}

      {isImage && att.preview ? (
        <img src={att.preview} alt={att.name} className="w-6 h-6 rounded object-cover shrink-0" />
      ) : (
        <Paperclip className="w-3 h-3 text-text-tertiary shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-text-secondary dark:text-text-secondary truncate">
          {att.name}
        </div>
        <div className="text-[9px] text-text-tertiary dark:text-text-tertiary">
          {formatFileSize(att.size)}
        </div>
      </div>

      <button
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary transition-all shrink-0"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function AttachmentBar() {
  const attachments = useAttachmentStore((s) => s.attachments);
  const removeFile = useAttachmentStore((s) => s.removeFile);

  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-1 pb-1">
      {attachments.map((att) => (
        <AttachmentPreview key={att.id} att={att} onRemove={() => removeFile(att.id)} />
      ))}
    </div>
  );
}

export function AttachmentButtons() {
  const { t } = useTranslation("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addFiles = useAttachmentStore((s) => s.addFiles);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const supervisorStatus = useSupervisorStore(
    (s) => (activeSessionId ? s.bySession[activeSessionId]?.status : null) ?? null,
  );
  const showStatus = useLayoutStore((s) => s.showStatus);
  const setActivePanelTab = useLayoutStore((s) => s.setActivePanelTab);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        addFiles(Array.from(files));
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const handleSupervisorClick = useCallback(() => {
    setActivePanelTab("status");
    showStatus();
  }, [setActivePanelTab, showStatus]);

  const shieldColor = !supervisorStatus?.enabled
    ? "text-text-tertiary dark:text-text-tertiary"
    : supervisorStatus.state === "idle" || supervisorStatus.state === "checking"
      ? "text-status-success"
      : supervisorStatus.state === "paused"
        ? "text-status-warning"
        : supervisorStatus.state === "continuing"
          ? "text-status-info"
          : "text-text-tertiary dark:text-text-tertiary";

  const isPulsing =
    supervisorStatus?.enabled === true &&
    (supervisorStatus.state === "checking" || supervisorStatus.state === "continuing");

  const pendingSeconds =
    supervisorStatus?.pendingPause && supervisorStatus.pendingPause.scheduledAt
      ? Math.max(0, Math.round((supervisorStatus.pendingPause.scheduledAt - Date.now()) / 1000))
      : null;

  return (
    <div className="flex flex-col gap-1 shrink-0 justify-between py-1">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="p-1.5 rounded-md hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary transition-colors"
        title={t("fileAttachment.addAttachment")}
      >
        <Paperclip className="w-4 h-4" />
      </button>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
      <button
        onClick={() => imageInputRef.current?.click()}
        className="p-1.5 rounded-md hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary transition-colors"
        title={t("fileAttachment.addImage")}
      >
        <ImageIcon className="w-4 h-4" />
      </button>

      <button
        onClick={handleSupervisorClick}
        className={`relative p-1.5 rounded-md hover:bg-surface-hover dark:hover:bg-surface-dim transition-colors ${shieldColor}`}
        title="Supervisor"
      >
        <Shield className={`w-4 h-4 ${isPulsing ? "animate-pulse" : ""}`} />
        {pendingSeconds !== null && pendingSeconds < 60 && pendingSeconds > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-status-warning text-white text-[8px] font-bold leading-none px-0.5">
            {pendingSeconds}
          </span>
        )}
      </button>
    </div>
  );
}
