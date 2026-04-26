import { memo } from "react";
import { Code } from "lucide-react";
import type { PreviewDetails } from "./types";
import { CardHeader } from "./CardHeader";

export const TextCard = memo(function TextCard({ details }: { details: PreviewDetails }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-700/40 bg-gray-900/60">
      <CardHeader
        icon={<Code className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
        label={details.title ?? details.source}
        meta={details.mimeType}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-4 text-xs text-gray-500 italic">
        Text file preview requires content loading. File: {details.source}
      </div>
    </div>
  );
});
