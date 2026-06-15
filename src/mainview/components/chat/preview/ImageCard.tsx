import { memo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";
import { MediaCardError } from "./MediaCardError";
import { useMediaCardError } from "../../../hooks/use-media-card-error";

export const ImageCard = memo(function ImageCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [loaded, setLoaded] = useState(false);
  const { error, errorKind, errorDetail, handleError, handleRetry, retryKey } = useMediaCardError(
    details.absolutePath,
  );
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  const handleRetryAndReload = () => {
    setLoaded(false);
    handleRetry();
  };

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
        onRetry={error ? handleRetryAndReload : undefined}
      />
      <div className="relative bg-surface-dim dark:bg-black/30 flex items-center justify-center min-h-[120px] max-h-[400px]">
        {!loaded && !error && (
          <div className="text-text-tertiary text-xs animate-pulse">{t("loadingImage")}</div>
        )}
        {error ? (
          <MediaCardError
            errorKind={errorKind}
            errorDetail={errorDetail}
            onRetry={handleRetryAndReload}
          />
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
