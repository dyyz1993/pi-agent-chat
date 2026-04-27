import { memo } from "react";
import { Pencil, AlertTriangle, FileText } from "lucide-react";
import type { ContentBlock } from "../../../types";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

interface LspDiagnosticIssue {
  severity?: number;
  line: number;
  message: string;
  source?: string;
  code?: string | number;
}

interface LspDiagnosticData {
  files?: Array<{
    filePath: string;
    summary: string;
    issues: LspDiagnosticIssue[];
  }>;
}

function isLspDiagnosticData(d: unknown): d is LspDiagnosticData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return Array.isArray(obj.files);
}

export const WriteFileCard = memo(function WriteFileCard({ block, blockId }: { block: Block; blockId?: string }) {
  const isRunning = block.status === "running";
  const isError = block.status === "error";

  let filePath = "";
  try {
    const parsed = JSON.parse(block.args || "{}");
    filePath = parsed.path || parsed.file_path || "";
  } catch {}

  const displayPath = filePath || block.args?.slice(0, 80) || "";

  const lspDetails = isLspDiagnosticData(block.details) ? block.details : null;

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

      {lspDetails && lspDetails.files && lspDetails.files.length > 0 && (
        <details className="group border-t border-yellow-700/20">
          <summary className="px-3 py-1 text-[11px] text-yellow-400 cursor-pointer hover:text-yellow-300 select-none flex items-center gap-1.5">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>LSP Diagnostics</span>
            <span className="text-yellow-600 ml-1">
              {lspDetails.files.reduce((acc, f) => acc + f.issues.length, 0)} issue{lspDetails.files.reduce((acc, f) => acc + f.issues.length, 0) !== 1 ? "s" : ""}
            </span>
          </summary>
          <div className="px-3 pb-2">
            {lspDetails.files.map((f) => (
              <div key={f.filePath} className="border-b last:border-b-0 border-yellow-700/10 py-1">
                <div className="text-[10px] text-yellow-300 font-medium flex items-center gap-1">
                  <FileText className="w-2.5 h-2.5 shrink-0" />
                  <span>{f.filePath}</span>
                  <span className="text-yellow-500 ml-1">{f.summary}</span>
                </div>
                {f.issues.map((issue, i) => (
                  <div key={i} className="text-[10px] text-gray-400 pl-4 pt-0.5">
                    <span className={issue.severity === 1 ? "text-red-400" : issue.severity === 2 ? "text-yellow-400" : "text-gray-500"}>
                      L{issue.line}
                    </span>
                    {issue.source && <span className="text-gray-600"> [{issue.source}]</span>}
                    {issue.code != null && <span className="text-gray-600"> ({String(issue.code)})</span>}
                    : {issue.message}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
});
