import { memo, useState } from "react";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getPreviewRenderableSource, isPreviewRemoteUrl } from "./types";
import { CardHeader } from "./CardHeader";
import { MediaCardError } from "./MediaCardError";
import { useMediaCardError } from "../../../hooks/use-media-card-error";
import { usePreviewRenderSource } from "../../../hooks/use-preview-render-source";

export const VideoCard = memo(function VideoCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [reloadKey, setReloadKey] = useState(0);
  const renderableSource = getPreviewRenderableSource(details);
  const localProbePath = isPreviewRemoteUrl(renderableSource) ? undefined : renderableSource;
  const previewSource = usePreviewRenderSource(renderableSource, details.mimeType, reloadKey);
  const { error, errorKind, errorDetail, handleError, handleRetry, retryKey } =
    useMediaCardError(localProbePath);

  const handleRetryAndReload = () => {
    if (previewSource.usesRpcPreview) setReloadKey((k) => k + 1);
    handleRetry();
  };

  if (!renderableSource) {
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

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<Video className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />}
        label={details.title ?? details.source}
        absolutePath={renderableSource}
        onRetry={error || !!previewSource.error ? handleRetryAndReload : undefined}
      />
      {previewSource.loading ? (
        <div className="px-3 py-4 text-xs text-text-tertiary animate-pulse">
          {t("loadingImage")}
        </div>
      ) : previewSource.error ? (
        <div className="bg-surface-dim dark:bg-black/30">
          <MediaCardError
            errorKind="server_error"
            errorDetail={previewSource.error}
            onRetry={handleRetryAndReload}
          />
        </div>
      ) : error ? (
        <div className="bg-surface-dim dark:bg-black/30">
          <MediaCardError
            errorKind={errorKind}
            errorDetail={errorDetail}
            onRetry={handleRetryAndReload}
          />
        </div>
      ) : previewSource.src ? (
        <video
          key={retryKey}
          src={previewSource.src}
          controls
          className="w-full max-h-[400px]"
          preload="metadata"
          onError={handleError}
        >
          Your browser does not support video playback.
        </video>
      ) : (
        <div className="px-3 py-4 text-xs text-text-tertiary italic">{t("noPathForPreview")}</div>
      )}
    </div>
  );
});
