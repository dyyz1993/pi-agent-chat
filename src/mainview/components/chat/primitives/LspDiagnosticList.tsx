import { memo } from "react";
import { FileText } from "lucide-react";
import { formatFilePath } from "../../../lib/format-path";

export interface LspDiagnosticIssue {
  severity?: number;
  line: number;
  message: string;
  source?: string;
  code?: string | number;
}

export interface LspDiagnosticFile {
  filePath: string;
  summary: string;
  issues: LspDiagnosticIssue[];
}

interface LspDiagnosticListProps {
  files: LspDiagnosticFile[];
  /** When true, applies formatFilePath to file paths. Default: true */
  formatPaths?: boolean;
  /** Font size class for issue rows. Default: "text-[10px]" */
  issueTextClass?: string;
}

/**
 * Renders a list of LSP diagnostic files with their issues.
 * Shared between LspDiagnosticsCard (standalone) and WriteFileCard (details).
 */
export const LspDiagnosticList = memo(function LspDiagnosticList({
  files,
  formatPaths = true,
  issueTextClass = "text-[10px]",
}: LspDiagnosticListProps) {
  return (
    <>
      {files.map((f) => (
        <div
          key={f.filePath}
          className="px-3 py-1.5 border-b last:border-b-0 border-status-warning/10"
        >
          <div className="text-[11px] text-status-warning font-medium flex items-center gap-1">
            <FileText className="w-3 h-3 shrink-0" />
            <span className="truncate" title={f.filePath}>
              {formatPaths ? formatFilePath(f.filePath) : f.filePath}
            </span>
            <span className="text-status-warning ml-1">{f.summary}</span>
          </div>
          {f.issues.map((issue, i) => (
            <div key={i} className={`${issueTextClass} text-text-tertiary pl-4 pt-0.5`}>
              <span
                className={
                  issue.severity === 1
                    ? "text-status-error"
                    : issue.severity === 2
                      ? "text-status-warning"
                      : "text-text-tertiary"
                }
              >
                L{issue.line}
              </span>
              {issue.source && <span className="text-text-tertiary"> [{issue.source}]</span>}
              {issue.code != null && (
                <span className="text-text-tertiary"> ({String(issue.code)})</span>
              )}
              : {issue.message}
            </div>
          ))}
        </div>
      ))}
    </>
  );
});
