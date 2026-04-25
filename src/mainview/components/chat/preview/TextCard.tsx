import { memo } from "react";
import { Code } from "lucide-react";
import type { PreviewDetails } from "./types";

export const TextCard = memo(function TextCard({ details }: { details: PreviewDetails }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <Code className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
        {details.mimeType && (
          <span className="text-gray-500 shrink-0 text-[10px]">{details.mimeType}</span>
        )}
      </div>
      <div className="px-3 py-4 text-xs text-gray-500 italic">
        Text file preview requires content loading. File: {details.source}
      </div>
    </div>
  );
});
