import { memo } from "react";
import { FileText } from "lucide-react";
import type { PreviewDetails } from "./types";
import { getFileHttpUrl } from "./types";

export const PdfCard = memo(function PdfCard({ details }: { details: PreviewDetails }) {
  const src = details.absolutePath ? getFileHttpUrl(details.absolutePath) : "";

  if (!src) {
    return <FallbackInfo details={details} icon={<FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />} />;
  }

  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        <FileText className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
      </div>
      <iframe
        src={src}
        className="w-full border-0"
        style={{ minHeight: 300, maxHeight: 600 }}
        title={details.title ?? details.source}
      />
    </div>
  );
});

function FallbackInfo({ details, icon }: { details: PreviewDetails; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
        {icon}
        <span className="text-gray-300 truncate min-w-0">{details.title ?? details.source}</span>
      </div>
      <div className="px-3 py-4 text-xs text-gray-500 italic">No path available for preview</div>
    </div>
  );
}
