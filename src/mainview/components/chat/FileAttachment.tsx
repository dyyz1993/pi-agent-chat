import { useRef, useCallback, useEffect, useState } from "react";
import { Paperclip, ImageIcon, X, Loader2, AlertCircle, Target, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAttachmentStore, type AttachmentFile } from "../../stores/use-attachment-store";
import { formatFileSize } from "../chat/preview/types";
import { useGoalStore } from "../../stores/use-goal-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { isVisionModel } from "../../lib/vision-detection";
import { ImageViewerOverlay } from "../primitives";

function AttachmentPreview({ att, onRemove }: { att: AttachmentFile; onRemove: () => void }) {
  const isImage = att.type.startsWith("image/");
  const [expanded, setExpanded] = useState(false);

  if (isImage && att.preview) {
    return (
      <>
        <div
          className="group flex max-w-[240px] items-center gap-2 rounded-xl border border-border-primary/80 bg-bg-secondary/80 px-1.5 py-1.5 text-xs shadow-sm"
          data-testid="attachment-chip"
        >
          <img
            src={att.preview}
            alt={att.name}
            className="h-8 w-8 shrink-0 rounded-lg border border-border-secondary/50 object-cover cursor-pointer transition-opacity hover:opacity-90"
            onClick={() => setExpanded(true)}
          />
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="min-w-0 flex-1 text-left"
            title={att.name}
          >
            <div className="truncate text-[11px] font-medium text-text-primary">{att.name}</div>
            <div className="truncate text-[10px] text-text-tertiary">
              {formatFileSize(att.size)}
            </div>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label="Remove attachment"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {expanded && (
          <ImageViewerOverlay src={att.preview} alt={att.name} onClose={() => setExpanded(false)} />
        )}
      </>
    );
  }

  return (
    <div
      className="group relative flex max-w-[240px] items-center gap-1.5 rounded-xl border border-border-primary/80 bg-bg-secondary/80 px-2 py-1.5 text-xs shadow-sm"
      data-testid="attachment-chip"
    >
      {att.status === "uploading" && (
        <Loader2 className="w-3 h-3 text-accent animate-spin shrink-0" />
      )}
      {att.status === "error" && <AlertCircle className="w-3 h-3 text-status-error shrink-0" />}
      {att.status === "done" && (
        <div className="w-3 h-3 rounded-full bg-status-success/80 shrink-0" />
      )}
      {att.status === "pending" && (
        <div className="w-3 h-3 rounded-full bg-text-secondary shrink-0" />
      )}

      <Paperclip className="w-3 h-3 text-text-tertiary shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-text-secondary truncate">{att.name}</div>
        <div className="text-[9px] text-text-tertiary">{formatFileSize(att.size)}</div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
        aria-label="Remove attachment"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

interface CompactStatusIcon {
  key: string;
  title: string;
  Icon: LucideIcon;
  className: string;
  onClick: () => void;
  onRemove?: () => void;
  pulse: boolean;
}

export function AttachmentBar() {
  const attachments = useAttachmentStore((s) => s.attachments);
  const removeFile = useAttachmentStore((s) => s.removeFile);

  if (attachments.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border-primary/70 px-2.5 py-2"
      data-testid="composer-attachment-bar"
    >
      {attachments.map((att) => (
        <AttachmentPreview key={att.id} att={att} onRemove={() => removeFile(att.id)} />
      ))}
    </div>
  );
}

export function AttachmentButtons({
  layout = "vertical",
  onGoalClick,
  mode = "normal",
  onExitGoalMode,
}: {
  layout?: "vertical" | "compact";
  onGoalClick?: () => void;
  mode?: "normal" | "goal";
  onExitGoalMode?: () => void;
} = {}) {
  const { t } = useTranslation("chat");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addFiles = useAttachmentStore((s) => s.addFiles);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const currentModel = useSessionStore((s) => s.currentModel);
  const availableModels = useSessionStore((s) => s.availableModels);
  const supportsVision = currentModel
    ? isVisionModel(
        availableModels.find(
          (m) => m.provider === currentModel.provider && m.id === currentModel.id,
        ) ?? {},
      )
    : false;
  const goalStatus = useGoalStore(
    (s) => (activeSessionId ? s.bySession[activeSessionId]?.status : null) ?? null,
  );
  const openStatusPanel = useLayoutStore((s) => s.openStatusPanel);

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

  const handleGoalClick = useCallback(() => {
    if (onGoalClick) {
      onGoalClick();
      return;
    }
    openStatusPanel("goal");
  }, [onGoalClick, openStatusPanel]);

  const goalRawStatus = goalStatus?.rawStatus;
  const goalColor = (() => {
    if (mode === "goal") return "text-accent";
    if (!goalStatus || goalRawStatus === "none") return "text-text-tertiary";
    if (goalRawStatus === "completed") return "text-status-success";
    if (goalStatus.state === "blocked" || goalRawStatus === "interrupted") return "text-status-warning";
    return "text-accent";
  })();

  const isPulsing =
    goalStatus?.enabled === true &&
    goalRawStatus !== "none" &&
    goalRawStatus !== "completed" &&
    goalRawStatus !== "cancelled" &&
    (goalStatus.state === "running" || goalStatus.state === "checking");

  const pendingSeconds = null;

  const isCompact = layout === "compact";
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [armedStatusKey, setArmedStatusKey] = useState<string | null>(null);
  const buttonClass = isCompact
    ? "flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
    : "p-1.5 rounded-md hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary transition-colors";
  const iconClass = isCompact ? "w-4 h-4" : "w-4 h-4";

  useEffect(() => {
    if (!isCompact || !isAddMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) {
        setIsAddMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAddMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAddMenuOpen, isCompact]);

  const openFilePicker = useCallback(() => {
    setIsAddMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const openImagePicker = useCallback(() => {
    setIsAddMenuOpen(false);
    imageInputRef.current?.click();
  }, []);

  const openGoalComposer = useCallback(() => {
    setIsAddMenuOpen(false);
    handleGoalClick();
  }, [handleGoalClick]);

  const showGoalIndicator =
    mode === "goal" || (!!goalStatus && goalRawStatus !== "none" && goalRawStatus !== "cancelled");
  const compactStatusIcon: CompactStatusIcon | null = showGoalIndicator
    ? {
        key: "goal",
        title: mode === "goal" ? t("goal.composerMode") : t("composerState.goalTitle"),
        Icon: Target,
        className: `${goalColor} border-accent/30 bg-accent/10`,
        onClick: mode === "goal" ? () => undefined : openGoalComposer,
        onRemove: mode === "goal" ? onExitGoalMode : undefined,
        pulse: isPulsing,
      }
    : null;
  const compactStatusKey = compactStatusIcon?.key ?? null;

  useEffect(() => {
    if (!compactStatusKey || armedStatusKey !== compactStatusKey) {
      setArmedStatusKey(null);
    }
  }, [armedStatusKey, compactStatusKey]);

  return (
    <div
      className={
        isCompact
          ? "flex shrink-0 items-center gap-1"
          : "flex flex-col gap-1 shrink-0 justify-between py-1"
      }
      data-testid="composer-tool-buttons"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      {isCompact ? (
        <div ref={addMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setIsAddMenuOpen((open) => !open)}
            className={`${buttonClass} ${isAddMenuOpen ? "bg-surface-hover text-text-primary" : ""}`}
            title={t("composerAddMenu.title")}
            aria-label={t("composerAddMenu.title")}
            aria-haspopup="menu"
            aria-expanded={isAddMenuOpen}
          >
            <Plus className={iconClass} />
          </button>
          {isAddMenuOpen && (
            <div
              className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-border-primary bg-bg-elevated/95 p-1.5 text-sm shadow-lg backdrop-blur-md"
              role="menu"
              data-testid="composer-add-menu"
            >
              <div className="px-2.5 py-1.5 text-xs font-medium text-text-tertiary">
                {t("composerAddMenu.title")}
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                onClick={openFilePicker}
                role="menuitem"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-text-secondary" />
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">
                    {t("composerAddMenu.files")}
                  </span>
                  <span className="block truncate text-xs text-text-tertiary">
                    {t("composerAddMenu.filesDesc")}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                onClick={openImagePicker}
                role="menuitem"
              >
                <ImageIcon className="h-4 w-4 shrink-0 text-text-secondary" />
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">
                    {t("composerAddMenu.image")}
                  </span>
                  <span className="block truncate text-xs text-text-tertiary">
                    {supportsVision
                      ? t("composerAddMenu.imageDesc")
                      : t("composerAddMenu.imageMcp")}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                onClick={openGoalComposer}
                role="menuitem"
              >
                <Target className={`h-4 w-4 shrink-0 ${goalColor}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-text-primary">{t("goal.entry")}</span>
                  <span className="block truncate text-xs text-text-tertiary">
                    {t("composerAddMenu.goalDesc")}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={buttonClass}
          title={t("fileAttachment.addAttachment")}
        >
          <Paperclip className={iconClass} />
        </button>
      )}

      {isCompact && compactStatusIcon && (
        <div
          className="flex min-w-0 items-center gap-1 overflow-hidden border-l border-border-primary/70 pl-1"
          data-testid="composer-state-indicators"
        >
          {(() => {
            const { key, title, Icon, className, onClick, onRemove, pulse } = compactStatusIcon;
            const armed = armedStatusKey === key && !!onRemove;
            return (
              <button
                type="button"
                onClick={() => {
                  if (!onRemove) {
                    onClick();
                    return;
                  }
                  if (!armed) {
                    setArmedStatusKey(key);
                    return;
                  }
                  setArmedStatusKey(null);
                  onRemove();
                }}
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors hover:bg-surface-hover ${className}`}
                title={armed ? t("goal.cancelCompose") : title}
                aria-label={armed ? t("goal.cancelCompose") : title}
                data-state={armed ? "armed-close" : "active"}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 transition-opacity ${
                    pulse ? "animate-pulse" : ""
                  } ${armed ? "opacity-25" : "opacity-100"}`}
                />
                {armed && <X className="absolute h-4 w-4 text-text-primary" />}
              </button>
            );
          })()}
        </div>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
      {!isCompact && (
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className={buttonClass}
          title={supportsVision ? t("fileAttachment.addImage") : t("fileAttachment.addImageMcp")}
        >
          <ImageIcon className={iconClass} />
        </button>
      )}

      {!isCompact && (
        <button
          type="button"
          onClick={handleGoalClick}
          className={`relative ${buttonClass} ${goalColor}`}
          title={t("goal.entry")}
          aria-label={t("goal.entry")}
        >
          <Target className={`${iconClass} ${isPulsing ? "animate-pulse" : ""}`} />
          {pendingSeconds !== null && pendingSeconds < 60 && pendingSeconds > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-status-warning text-white text-[8px] font-bold leading-none px-0.5">
              {pendingSeconds}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
