import { memo } from "react";
import { FileText } from "lucide-react";
import type { PreviewDetails } from "./types";
import { CardHeader } from "./CardHeader";

export const MarkdownCard = memo(function MarkdownCard({ details }: { details: PreviewDetails }) {
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700/40 bg-white dark:bg-gray-900/60">
      <CardHeader
        icon={<FileText className="w-3.5 h-3.5 text-teal-500 dark:text-teal-400 shrink-0" />}
        label={details.title ?? details.source}
        absolutePath={details.absolutePath}
      />
      <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 italic">
        Markdown preview requires content loading. File: {details.source}
      </div>
    </div>
  );
});
