import { memo } from "react";
import { Music } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";

export const AudioCard = memo(function AudioCard({ details }: { details: PreviewDetails }) {
  const httpUrl = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
      <CardHeader
        icon={<Music className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.size ? formatFileSize(details.size) : undefined}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-2">
        {httpUrl ? (
          <audio src={httpUrl} controls className="w-full h-8" preload="metadata">
            Your browser does not support audio playback.
          </audio>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-500 italic">
            No path available for preview
          </div>
        )}
      </div>
    </div>
  );
});
