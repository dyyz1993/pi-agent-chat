import { memo } from "react";
import { FileText } from "lucide-react";
import type { PreviewDetails } from "./types";

export const MarkdownCard = memo(function MarkdownCard({ details }: { details: PreviewDetails }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <FileText className="w-3.5 h-3.5 text-teal-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
      </div>
      <div className="px-3 py-4 text-xs text-gray-500 italic">
        Markdown preview requires content loading. File: {details.source}
      </div>
    </div>
  );
});
