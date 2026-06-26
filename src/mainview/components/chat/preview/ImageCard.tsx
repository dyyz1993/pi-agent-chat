import { memo, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { formatFileSize, getPreviewRenderableSource, isPreviewRemoteUrl } from "./types";
import { CardHeader } from "./CardHeader";
import { MediaCardError } from "./MediaCardError";
import { useMediaCardError } from "../../../hooks/use-media-card-error";
import { usePreviewRenderSource } from "../../../hooks/use-preview-render-source";

export const ImageCard = memo(function ImageCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [loaded, setLoaded] = useState(false);
  const [desktopReloadKey, setDesktopReloadKey] = useState(0);
  const renderableSource = getPreviewRenderableSource(details);
  const localPreviewPath = isPreviewRemoteUrl(renderableSource) ? undefined : renderableSource;
  const previewSource = usePreviewRenderSource(renderableSource, details.mimeType, desktopReloadKey);
  const { error, errorKind, errorDetail, handleError, handleRetry, retryKey } = useMediaCardError(
    localPreviewPath,
  );

  const handleRetryAndReload = () => {
    setLoaded(false);
    if (previewSource.usesRpcPreview) {
      setDesktopReloadKey((k) => k + 1);
    }
    handleRetry();
  };

  if (!renderableSource) {
    return <FallbackCard details={details} />;
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary dark:border-border-secondary/40 bg-bg-elevated dark:bg-surface-code/60">
      <CardHeader
        icon={<ImageIcon className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.size ? formatFileSize(details.size) : undefined}
        absolutePath={renderableSource}
        onRetry={error || !!previewSource.error ? handleRetryAndReload : undefined}
      />
      <div className="relative bg-surface-dim dark:bg-black/30 flex items-center justify-center min-h-[120px] max-h-[400px]">
        {(previewSource.loading || (!loaded && !error && !previewSource.error)) && (
          <div className="text-text-tertiary text-xs animate-pulse">{t("loadingImage")}</div>
        )}
        {previewSource.error ? (
          <MediaCardError
            errorKind="server_error"
            errorDetail={previewSource.error}
            onRetry={handleRetryAndReload}
          />
        ) : error ? (
          <MediaCardError
            errorKind={errorKind}
            errorDetail={errorDetail}
            onRetry={handleRetryAndReload}
          />
        ) : (
          previewSource.src && (
            <img
              key={retryKey}
              src={previewSource.src}
              alt={details.title ?? details.source}
              className={`max-w-full max-h-[400px] object-contain ${loaded ? "block" : "hidden"}`}
              onLoad={() => setLoaded(true)}
              onError={handleError}
            />
          )
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
