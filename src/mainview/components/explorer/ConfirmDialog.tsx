import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../../hooks/use-focus-trap";

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation("common");
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { onEscape: onCancel });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-lg shadow-2xl p-4 min-w-[300px] max-w-[400px]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-sm font-semibold text-text-primary mb-2">{title}</h3>
        <p className="text-xs text-text-secondary mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs bg-surface-hover hover:bg-surface-hover dark:hover:bg-surface-hover rounded transition-colors text-text-primary"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-status-error hover:bg-status-error/80 rounded transition-colors text-white"
            onClick={onConfirm}
          >
            {t("delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
