import { memo } from "react";
import { Music } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";
import { MediaCardError } from "./MediaCardError";
import { useMediaCardError } from "../../../hooks/use-media-card-error";

export const AudioCard = memo(function AudioCard({ details }: { details: PreviewDetails }) {
  const { t } = useTranslation("chat");
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const { error, errorKind, errorDetail, handleError, handleRetry, retryKey } = useMediaCardError(
    details.absolutePath,
  );

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
          <MediaCardError
            errorKind={errorKind}
            errorDetail={errorDetail}
            onRetry={handleRetry}
          />
        ) : httpUrl ? (
          <audio
            key={retryKey}
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
