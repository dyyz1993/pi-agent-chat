import { memo } from "react";
import { Eye } from "lucide-react";
import type { ContentBlock } from "../../../types";
import { PreviewCard, type PreviewDetails } from "../preview";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

export const PreviewRenderer = memo(function PreviewRenderer({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const details = block.details as PreviewDetails | undefined;

  if (!details || details.status === "error" || details.status === "not_found") {
    const isRunning = block.status === "running";
    const isError = block.status === "error" || details?.status === "not_found";

    let filePath = "";
    try {
      const parsed = JSON.parse(block.args ?? "{}") as { source?: string };
      filePath = parsed.source ?? "";
    } catch {
      /* args not valid JSON, use default */
    }

    return (
      <div
        data-block-id={blockId}
        className={`border-x-0 border-t border-b overflow-hidden ${
          isRunning
            ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/10"
            : isError
              ? "border-red-500/15 bg-red-50 dark:bg-red-950/8"
              : "border-gray-200 dark:border-gray-700/30 bg-gray-50 dark:bg-gray-800/15"
        }`}
      >
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
          <Eye
            className={`w-3.5 h-3.5 shrink-0 ${isError ? "text-red-500 dark:text-red-400" : "text-cyan-500 dark:text-cyan-400"}`}
          />
          <span className="min-w-0 text-gray-800 dark:text-gray-300 font-mono truncate">
            {filePath || block.args}
          </span>
          {isRunning && (
            <span className="ml-auto text-[10px] text-blue-500 dark:text-blue-400 animate-pulse shrink-0">
              previewing
            </span>
          )}
          {isError && (
            <span className="ml-auto text-[10px] text-red-500 dark:text-red-400 shrink-0">
              error
            </span>
          )}
        </div>
        {block.output && (
          <div className="px-3 pb-2">
            <pre className="text-[11px] text-gray-600 dark:text-gray-400 overflow-x-auto whitespace-pre-wrap font-mono max-h-32 overflow-y-auto bg-gray-100 dark:bg-black/20 rounded px-2 py-1.5">
              {block.output}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-block-id={blockId} className="my-1">
      <PreviewCard details={details} />
    </div>
  );
});
