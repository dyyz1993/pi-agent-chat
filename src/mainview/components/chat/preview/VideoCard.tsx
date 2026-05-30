import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Video, ShieldAlert, FileX, WifiOff, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { CardHeader } from "./CardHeader";
import { probeFileError, type FileErrorKind } from "./probe-file-error";

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

export const VideoCard = memo(function VideoCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const [videoKey, setVideoKey] = useState(0);
  const [error, setError] = useState(false);
  const [errorKind, setErrorKind] = useState<FileErrorKind | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const probingRef = useRef(false);

  const handleError = useCallback(() => {
    setError(true);
    if (details.absolutePath && !probingRef.current) {
      probingRef.current = true;
      probeFileError(details.absolutePath).then((result) => {
        if (!result.ok) {
          setErrorKind(result.error ?? "network");
          setErrorDetail(result.detail ?? null);
        }
      });
    }
  }, [details.absolutePath]);

  const handleRetry = useCallback(() => {
    setError(false);
    setErrorKind(null);
    setErrorDetail(null);
    probingRef.current = false;
    setVideoKey((k) => k + 1);
  }, []);

  useEffect(() => {
    probingRef.current = false;
  }, [videoKey]);

  if (!httpUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
        <CardHeader
          icon={<Video className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />}
          label={details.title ?? details.source}
        />
        <div className="px-3 py-4 text-xs text-text-tertiary italic">{t("noPathForPreview")}</div>
      </div>
    );
  }

  const ErrorIcon = errorKind ? ERROR_ICON_MAP[errorKind] : AlertCircle;

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<Video className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />}
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
        onRetry={error ? handleRetry : undefined}
      />
      {error ? (
        <div className="flex flex-col items-center gap-1.5 py-6 px-4 bg-surface-dim dark:bg-black/30">
          <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400 text-xs">
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
            onClick={handleRetry}
            className="text-[10px] text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary underline underline-offset-2 transition-colors mt-1"
          >
            {t("retry")}
          </button>
        </div>
      ) : (
        <video
          key={videoKey}
          src={httpUrl}
          controls
          className="w-full max-h-[400px]"
          preload="metadata"
          onError={handleError}
        >
          Your browser does not support video playback.
        </video>
      )}
    </div>
  );
});
