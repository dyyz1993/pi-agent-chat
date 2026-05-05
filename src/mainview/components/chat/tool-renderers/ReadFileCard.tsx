import { memo } from "react";
import { FileText, Zap } from "lucide-react";
import type { ContentBlock } from "../../../types";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

interface MatchedRuleDetail {
  name: string;
  title: string;
  severity: string;
  matchedGlob: string;
}

interface RulesMatchedData {
  rulesMatched?: MatchedRuleDetail[];
  matchedFilePath?: string;
}

function isRulesMatchedData(d: unknown): d is RulesMatchedData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.rulesMatched);
}

export const ReadFileCard = memo(function ReadFileCard({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  let filePath = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as { path?: string };
    filePath = parsed.path ?? "";
  } catch {
    /* args not valid JSON, use default */
  }

  const displayPath = filePath || block.args?.slice(0, 80) || "";
  const rulesData = isRulesMatchedData(block.details) ? block.details : null;

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
        <FileText
          className={`w-3.5 h-3.5 shrink-0 ${isRunning ? "text-blue-500 dark:text-blue-400" : isError ? "text-red-500 dark:text-red-400" : "text-blue-500/70 dark:text-blue-400/60"}`}
        />
        <span
          className="min-w-0 text-gray-800 dark:text-gray-300 font-mono text-[11px]"
          title={displayPath}
        >
          <span className="block truncate rtl" style={{ direction: "rtl", textAlign: "left" }}>
            <span style={{ direction: "ltr", display: "inline" }}>{displayPath}</span>
          </span>
        </span>
        {isRunning && (
          <span className="ml-auto text-[10px] text-blue-500 dark:text-blue-400 animate-pulse shrink-0">
            reading
          </span>
        )}
      </div>

      <details className="group" open>
        <summary className="sr-only">展开</summary>
        <div className="px-3 pb-2">
          {block.output ? (
            <pre className="text-[11px] text-gray-800 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto bg-gray-100 dark:bg-black/20 rounded px-2 py-1.5">
              {block.output}
            </pre>
          ) : isRunning ? (
            <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
              读取中...
            </div>
          ) : null}
        </div>
      </details>

      {rulesData && rulesData.rulesMatched && rulesData.rulesMatched.length > 0 && (
        <details className="group border-t border-indigo-300/30 dark:border-indigo-700/20">
          <summary className="px-3 py-1 text-[11px] text-indigo-600 dark:text-indigo-400 cursor-pointer hover:text-indigo-500 dark:hover:text-indigo-300 select-none flex items-center gap-1.5">
            <svg
              className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4.5 3l3 3-3 3" />
            </svg>
            <Zap className="w-3 h-3 shrink-0" />
            <span>Rules Loaded</span>
            <span className="text-indigo-500 dark:text-indigo-600 ml-1">
              {rulesData.rulesMatched.length} rule{rulesData.rulesMatched.length !== 1 ? "s" : ""}
            </span>
          </summary>
          <div className="px-3 pb-2">
            {rulesData.rulesMatched.map((rule) => (
              <div
                key={rule.name}
                className="border-b last:border-b-0 border-indigo-200/20 dark:border-indigo-700/10 py-1 flex items-center gap-1.5"
              >
                <span
                  className={`text-[10px] font-medium shrink-0 ${rule.severity === "critical" ? "text-red-500 dark:text-red-400" : rule.severity === "high" ? "text-amber-600 dark:text-amber-400" : "text-indigo-700 dark:text-indigo-300"}`}
                >
                  {rule.title}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono">
                  {rule.matchedGlob}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
});
