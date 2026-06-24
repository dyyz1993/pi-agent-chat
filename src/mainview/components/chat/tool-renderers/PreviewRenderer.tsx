import { memo } from "react";
import { createLogger } from "../../../../shared/lib/logger";
import type { ContentBlock } from "../../../types";
import { PreviewCard, type PreviewDetails } from "../preview";
import { ToolCardHeader } from "../primitives/ToolCardHeader";
import { formatToolHeaderPath, useKnownProjectRoots } from "../../../lib/format-path";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("chat");

export const PreviewRenderer = memo(function PreviewRenderer({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const details = block.details as PreviewDetails | undefined;
  const projectRoots = useKnownProjectRoots();

  if (!details || details.status === "error" || details.status === "not_found") {
    const isRunning = block.status === "running";
    const isError = block.status === "error" || details?.status === "not_found";

    let filePath = "";
    try {
      const parsed = JSON.parse(block.args ?? "{}") as { source?: string };
      filePath = parsed.source ?? "";
    } catch (e) {
      logger.warn("Failed to parse preview args", { error: String(e) });
    }

    return (
      <div
        data-block-id={blockId}
        className={`border-x-0 border-t border-b overflow-hidden ${
          isRunning
            ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20"
            : isError
              ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
              : "border-border-secondary/30 bg-surface-dim"
        }`}
      >
        <ToolCardHeader
          toolName="preview"
          status={isRunning ? "running" : isError ? "error" : "done"}
          description={
            filePath ? formatToolHeaderPath(filePath, projectRoots) : block.args || block.toolName
          }
          mono
          rtl
          startedAt={block.startedAt}
          endedAt={block.endedAt}
          badge={
            isRunning ? (
              <span className="text-[10px] text-blue-500 dark:text-blue-400 animate-pulse shrink-0">
                previewing
              </span>
            ) : isError ? (
              <span className="text-[10px] text-red-500 dark:text-red-400 shrink-0">error</span>
            ) : undefined
          }
        />
        {block.output && (
          <div className="px-3 pb-2">
            <pre className="text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono max-h-32 overflow-y-auto bg-surface-code rounded px-2 py-1.5">
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
