import { memo, useState, useCallback } from "react";
import { Video } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";
import { CardHeader } from "./CardHeader";

export const VideoCard = memo(function VideoCard({ details }: { details: PreviewDetails }) {
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";
  const [videoKey, setVideoKey] = useState(0);

  const handleRetry = useCallback(() => {
    setVideoKey((k) => k + 1);
  }, []);

  if (!httpUrl) {
    return (
      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
        <CardHeader
          icon={<Video className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />}
          label={details.title ?? details.source}
        />
        <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 italic">No path available for preview</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
      <CardHeader
        icon={<Video className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400 shrink-0" />}
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
        onRetry={handleRetry}
      />
      <video
        key={videoKey}
        src={httpUrl}
        controls
        className="w-full max-h-[400px]"
        preload="metadata"
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
});
