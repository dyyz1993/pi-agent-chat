import { memo } from "react";
import { Pencil } from "lucide-react";
import type { ContentBlock } from "../../../types";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

export const WriteFileCard = memo(function WriteFileCard({ block, blockId }: { block: Block; blockId?: string }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  let filePath = "";
  try {
    const parsed = JSON.parse(block.args || "{}");
    filePath = parsed.path || parsed.file_path || "";
  } catch {}

  const displayPath = filePath || block.args?.slice(0, 80) || "";

  return (
    <div data-block-id={blockId} className={`my-1 -mx-3 border-x-0 border-t border-b overflow-hidden ${
      isRunning ? "border-green-500/25 bg-green-950/10" : isError ? "border-red-500/15 bg-red-950/8" : "border-gray-700/30 bg-gray-800/15"
    }`}>
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <Pencil className={`w-3.5 h-3.5 shrink-0 ${isRunning ? "text-green-400" : isError ? "text-red-400" : "text-green-400/60"}`} />
        <span className="min-w-0 text-gray-300 font-mono text-[11px]" title={displayPath}>
          <span className="block truncate rtl" style={{ direction: "rtl", textAlign: "left" }}>
            <span style={{ direction: "ltr", display: "inline" }}>{displayPath}</span>
          </span>
        </span>
        {isRunning && <span className="ml-auto text-[10px] text-green-400 animate-pulse shrink-0">writing</span>}
      </div>

      <details open className="group">
        <summary className="sr-only">展开</summary>
        <div className="px-3 pb-2">
          {block.output ? (
            <pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto bg-black/20 rounded px-2 py-1.5">{block.output}</pre>
          ) : isRunning ? (
            <div className="text-[11px] text-gray-600 italic py-1">写入中...</div>
          ) : null}
        </div>
      </details>
    </div>
  );
});
