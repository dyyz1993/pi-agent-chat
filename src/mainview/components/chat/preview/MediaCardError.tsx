import { memo } from "react";
import { AlertCircle, ShieldAlert, FileX, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileErrorKind } from "../../../hooks/use-media-card-error";

const ERROR_ICON_MAP: Record<FileErrorKind, typeof ShieldAlert> = {
  forbidden: ShieldAlert,
  not_found: FileX,
  server_error: AlertCircle,
  network: WifiOff,
};

const ERROR_I18N_MAP: Record<FileErrorKind, string> = {
  forbidden: "fileForbidden",
  not_found: "fileNotFound",
  server_error: "fileServerError",
  network: "fileNetworkError",
};

interface MediaCardErrorProps {
  errorKind: FileErrorKind | null;
  errorDetail: string | null;
  onRetry: () => void;
}

/**
 * Shared error state UI for media preview cards (Audio/Image/Video).
 * Renders the error icon, message, optional detail, forbidden hint, and retry button.
 */
export const MediaCardError = memo(function MediaCardError({
  errorKind,
  errorDetail,
  onRetry,
}: MediaCardErrorProps) {
  const { t } = useTranslation("chat");
  const ErrorIcon = errorKind ? ERROR_ICON_MAP[errorKind] : AlertCircle;

  return (
    <div className="flex flex-col items-center gap-1.5 py-6 px-4">
      <div className="flex items-center gap-1.5 text-status-error text-xs">
        <ErrorIcon className="w-3.5 h-3.5 shrink-0" />
        <span>{errorKind ? t(ERROR_I18N_MAP[errorKind]) : t("failedToLoadImage")}</span>
      </div>
      {errorDetail && (
        <div className="text-[10px] text-text-tertiary max-w-full truncate" title={errorDetail}>
          {errorDetail}
        </div>
      )}
      {errorKind === "forbidden" && (
        <div className="text-[10px] text-text-tertiary mt-0.5">{t("fileForbiddenHint")}</div>
      )}
      <button
        onClick={onRetry}
        className="text-[10px] text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary underline underline-offset-2 transition-colors mt-1"
      >
        {t("retry")}
      </button>
    </div>
  );
});
