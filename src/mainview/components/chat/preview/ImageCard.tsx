import { memo, useState, useCallback } from "react";
import { Image as ImageIcon, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";

export const ImageCard = memo(function ImageCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  const handleRetry = useCallback(() => {
    setError(false);
    setLoaded(false);
    setRetryKey((k) => k + 1);
  }, []);

  if (!src) {
    return <FallbackCard details={details} />;
  }

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
          <div className="text-text-tertiary dark:text-text-tertiary text-xs animate-pulse">
            {t("loadingImage")}
          </div>
        )}
        {error ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="flex items-center gap-1.5 text-red-500 dark:text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{t("failedToLoadImage")}</span>
            </div>
            <button
              onClick={handleRetry}
              className="text-[10px] text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary underline underline-offset-2 transition-colors"
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
            onError={() => setError(true)}
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
        icon={
          <ImageIcon className="w-3.5 h-3.5 text-text-tertiary dark:text-text-tertiary shrink-0" />
        }
        label={details.title ?? details.source}
      />
      <div className="px-3 py-4 text-xs text-text-tertiary dark:text-text-tertiary italic">
        {t("noPathForPreview")}
      </div>
    </div>
  );
}
