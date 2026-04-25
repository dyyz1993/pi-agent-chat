import { memo } from "react";
import { Music } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";

export const AudioCard = memo(function AudioCard({ details }: { details: PreviewDetails }) {
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <Music className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
        {details.size && (
          <span className="text-gray-500 shrink-0">{formatFileSize(details.size)}</span>
        )}
      </div>
      <div className="px-4 py-3">
        {src ? (
          <audio src={src} controls className="w-full h-8" preload="metadata">
            Your browser does not support audio playback.
          </audio>
        ) : (
          <div className="text-xs text-gray-500 italic">No path available for preview</div>
        )}
      </div>
    </div>
  );
});
