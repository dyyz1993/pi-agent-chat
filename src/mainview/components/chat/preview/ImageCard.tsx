import { memo, useState } from "react";
import { Image as ImageIcon, AlertCircle } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";

export const ImageCard = memo(function ImageCard({ details }: { details: PreviewDetails }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  if (!src) {
    return <FallbackCard details={details} />;
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
        {details.size && (
          <span className="text-gray-500 shrink-0">{formatFileSize(details.size)}</span>
        )}
      </div>
      <div className="relative bg-black/30 flex items-center justify-center min-h-[120px] max-h-[400px]">
        {!loaded && !error && (
          <div className="text-gray-500 text-xs animate-pulse">Loading image...</div>
        )}
        {error ? (
          <div className="flex items-center gap-1.5 text-red-400 text-xs py-6">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Failed to load image</span>
          </div>
        ) : (
          <img
            src={src}
            alt={details.title ?? details.source}
            className={`max-w-full max-h-[400px] object-contain ${loaded ? "block" : "hidden"}`}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
          />
        )}
      </div>
    </div>
  );
});

function FallbackCard({ details }: { details: PreviewDetails }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <ImageIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
      </div>
      <div className="px-3 py-4 text-xs text-gray-500 italic">No path available for preview</div>
    </div>
  );
}
