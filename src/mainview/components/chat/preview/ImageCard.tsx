import { memo, useState, useCallback, useEffect, useRef } from "react";
import { Image as ImageIcon, AlertCircle, ShieldAlert, FileX, WifiOff } from "lucide-react";
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

export const ImageCard = memo(function ImageCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [errorKind, setErrorKind] = useState<FileErrorKind | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const probingRef = useRef(false);
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  const handleError = useCallback(() => {
    setError(true);
    // 用 /info/ 端点探测具体原因（只探测一次，不重复）
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
    setLoaded(false);
    setErrorKind(null);
    setErrorDetail(null);
    probingRef.current = false;
    setRetryKey((k) => k + 1);
  }, []);

  // retryKey 变化时重置探测标记
  useEffect(() => {
    probingRef.current = false;
  }, [retryKey]);

  if (!src) {
    return <FallbackCard details={details} />;
  }

  const ErrorIcon = errorKind ? ERROR_ICON_MAP[errorKind] : AlertCircle;

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <CardHeader
        icon={<ImageIcon className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.size ? formatFileSize(details.size) : undefined}
        absolutePath={details.absolutePath}
        onRetry={error ? handleRetry : undefined}
      />
      <div className="relative bg-surface-dim dark:bg-black/30 flex items-center justify-center min-h-[120px] max-h-[400px]">
        {!loaded && !error && (
          <div className="text-text-tertiary text-xs animate-pulse">{t("loadingImage")}</div>
        )}
        {error ? (
          <div className="flex flex-col items-center gap-1.5 py-6 px-4">
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
        ) : (
          <img
            key={retryKey}
            src={src}
            alt={details.title ?? details.source}
            className={`max-w-full max-h-[400px] object-contain ${loaded ? "block" : "hidden"}`}
            onLoad={() => setLoaded(true)}
            onError={handleError}
          />
        )}
      </div>
    </div>
  );
});

function FallbackCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <CardHeader
        icon={<ImageIcon className="w-3.5 h-3.5 text-text-tertiary shrink-0" />}
        label={details.title ?? details.source}
      />
      <div className="px-3 py-4 text-xs text-text-tertiary italic">{t("noPathForPreview")}</div>
    </div>
  );
}
