import { memo, useState, useCallback } from "react";
import { Image as ImageIcon, AlertCircle } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl, formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";

export const ImageCard = memo(function ImageCard({ details }: { details: PreviewDetails }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  const handleRetry = useCallback(() => {
    setError(false);
    setLoaded(false);
    setRetryKey((k) => k + 1);
  }, []);

  if (!src) {
    return <FallbackCard details={details} />;
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <CardHeader
        icon={<ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.size ? formatFileSize(details.size) : undefined}
        absolutePath={details.absolutePath}
        onRetry={error ? handleRetry : undefined}
      />
      <div className="relative bg-black/30 flex items-center justify-center min-h-[120px] max-h-[400px]">
        {!loaded && !error && (
          <div className="text-gray-500 text-xs animate-pulse">Loading image...</div>
        )}
        {error ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <div className="flex items-center gap-1.5 text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Failed to load image</span>
            </div>
            <button
              onClick={handleRetry}
              className="text-[10px] text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <img
            key={retryKey}
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
      <CardHeader
        icon={<ImageIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
        label={details.title ?? details.source}
      />
      <div className="px-3 py-4 text-xs text-gray-500 italic">No path available for preview</div>
    </div>
  );
}
