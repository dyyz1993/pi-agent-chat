import { memo } from "react";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { CardHeader } from "./CardHeader";
import { MediaCardError } from "./MediaCardError";
import { useMediaCardError } from "../../../hooks/use-media-card-error";

export const VideoCard = memo(function VideoCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const { error, errorKind, errorDetail, handleError, handleRetry, retryKey } = useMediaCardError(
    details.absolutePath,
  );

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

  return (
    <div className="rounded-lg overflow-hidden border border-border-secondary bg-bg-elevated">
      <CardHeader
        icon={<Video className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />}
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
        onRetry={error ? handleRetry : undefined}
      />
      {error ? (
        <div className="bg-surface-dim dark:bg-black/30">
          <MediaCardError
            errorKind={errorKind}
            errorDetail={errorDetail}
            onRetry={handleRetry}
          />
        </div>
      ) : (
        <video
          key={retryKey}
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
