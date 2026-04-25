import { memo } from "react";
import { Video } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";

export const VideoCard = memo(function VideoCard({ details }: { details: PreviewDetails }) {
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  if (!src) {
    return (
      <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
          <Video className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
        </div>
        <div className="px-3 py-4 text-xs text-gray-500 italic">No path available for preview</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <Video className="w-3.5 h-3.5 text-purple-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
      </div>
      <video
        src={src}
        controls
        className="w-full max-h-[400px]"
        preload="metadata"
      >
        Your browser does not support video playback.
      </video>
    </div>
  );
});
