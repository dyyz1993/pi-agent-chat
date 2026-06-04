import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Music, ShieldAlert, FileX, WifiOff, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";
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

export const AudioCard = memo(function AudioCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const [audioKey, setAudioKey] = useState(0);
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
    setAudioKey((k) => k + 1);
  }, []);

  useEffect(() => {
    probingRef.current = false;
  }, [audioKey]);

  const ErrorIcon = errorKind ? ERROR_ICON_MAP[errorKind] : AlertCircle;

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<Music className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.size ? formatFileSize(details.size) : undefined}
        absolutePath={details.absolutePath}
        onRetry={error ? handleRetry : undefined}
      />
      <div className="px-3 py-2">
        {error ? (
          <div className="flex flex-col items-center gap-1.5 py-3">
            <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400 text-xs">
              <ErrorIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{errorKind ? t(ERROR_I18N_MAP[errorKind]) : t("failedToLoadImage")}</span>
            </div>
            {errorDetail && (
              <div
                className="text-[10px] text-text-tertiary max-w-full truncate"
                title={errorDetail}
              >
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
        ) : httpUrl ? (
          <audio
            key={audioKey}
            src={httpUrl}
            controls
            className="w-full h-8"
            preload="metadata"
            onError={handleError}
          >
            Your browser does not support audio playback.
          </audio>
        ) : (
          <div className="text-xs text-text-tertiary italic">{t("noPathForPreview")}</div>
        )}
      </div>
    </div>
  );
});
