import { memo, useState } from "react";
import { Music } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import {
  formatFileSize,
  getPreviewRenderableSource,
  isPreviewRemoteUrl,
} from "./types";
import { CardHeader } from "./CardHeader";
import { MediaCardError } from "./MediaCardError";
import { useMediaCardError } from "../../../hooks/use-media-card-error";
import { usePreviewRenderSource } from "../../../hooks/use-preview-render-source";

export const AudioCard = memo(function AudioCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const [reloadKey, setReloadKey] = useState(0);
  const renderableSource = getPreviewRenderableSource(details);
  const localProbePath = isPreviewRemoteUrl(renderableSource) ? undefined : renderableSource;
  const previewSource = usePreviewRenderSource(renderableSource, details.mimeType, reloadKey);
  const { error, errorKind, errorDetail, handleError, handleRetry, retryKey } = useMediaCardError(
    localProbePath,
  );

  const handleRetryAndReload = () => {
    if (previewSource.usesRpcPreview) setReloadKey((k) => k + 1);
    handleRetry();
  };

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<Music className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.size ? formatFileSize(details.size) : undefined}
        absolutePath={renderableSource}
        onRetry={error || !!previewSource.error ? handleRetryAndReload : undefined}
      />
      <div className="px-3 py-2">
        {previewSource.loading ? (
          <div className="text-xs text-text-tertiary animate-pulse">{t("loadingImage")}</div>
        ) : previewSource.error ? (
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
        ) : previewSource.src ? (
          <audio
            key={retryKey}
            src={previewSource.src}
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
