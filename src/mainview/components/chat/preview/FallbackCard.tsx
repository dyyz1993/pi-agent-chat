import { memo } from "react";
import { AlertCircle, FileQuestion } from "lucide-react";
import type { PreviewDetails } from "./types";
import { formatFileSize } from "./types";
import { CardHeader } from "./CardHeader";

export const FallbackCard = memo(function FallbackCard({ details }: { details: PreviewDetails }) {
  const hasError = details.status === "error" || details.status === "not_found";

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <CardHeader
        icon={
          hasError ? (
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
          ) : (
            <FileQuestion className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          )
        }
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-3 text-xs space-y-1">
        {details.error ? (
          <div className="text-red-400">{details.error}</div>
        ) : (
          <>
            <div className="text-gray-400">Type: {details.resourceType}</div>
            {details.mimeType && <div className="text-gray-500">MIME: {details.mimeType}</div>}
            {details.size != null && <div className="text-gray-500">Size: {formatFileSize(details.size)}</div>}
          </>
        )}
      </div>
    </div>
  );
});
