import { memo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, FileText } from "lucide-react";
import { formatFilePath } from "../../lib/format-path";

export const LspDiagnosticsCard = memo(function LspDiagnosticsCard({ data }: { data: unknown }) {
  const { t } = useTranslation("chat");
  if (!data || typeof data !== "object") {
    return (
      <div className="my-0.5 overflow-hidden bg-status-warning/5">
        <div className="px-4 py-1 text-[11px] font-medium text-status-warning flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{t("lspDiagnostics")}</span>
        </div>
      </div>
    );
  }

  const details = data as {
    files?: Array<{
      filePath: string;
      summary: string;
      issues: Array<{
        severity?: number;
        line: number;
        message: string;
        source?: string;
        code?: string | number;
      }>;
    }>;
  };

  return (
    <div className="my-0.5 border border-status-warning/30 rounded-lg overflow-hidden bg-status-warning/50 dark:bg-status-warning/10">
      <div className="px-3 py-1.5 text-xs font-medium text-status-warning flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span>{t("lspDiagnostics")}</span>
      </div>
      <div className="border-t border-status-warning/20">
        {details.files?.map((f) => (
          <div
            key={f.filePath}
            className="px-3 py-1.5 border-b last:border-b-0 border-status-warning/10"
          >
            <div className="text-[11px] text-status-warning font-medium flex items-center gap-1">
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate" title={f.filePath}>
                {formatFilePath(f.filePath)}
              </span>
              <span className="text-status-warning ml-1">{f.summary}</span>
            </div>
            {f.issues.map((issue, i) => (
              <div key={i} className="text-[10px] text-text-tertiary pl-4 pt-0.5">
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
      </div>
    </div>
  );
});
