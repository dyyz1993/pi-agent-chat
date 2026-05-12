import { memo, useState, useMemo } from "react";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle,
  FileCode,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock } from "../../../types";
import { CopyButton } from "../CopyButton";

interface LspDiagnostic {
  range?: {
    start?: { line?: number; character?: number };
    end?: { line?: number; character?: number };
  };
  severity?: number;
  code?: string | number;
  message?: string;
  source?: string;
  relatedInformation?: unknown[];
}

interface LspExecutionCardProps {
  block: Extract<ContentBlock, { type: "toolExecution" }>;
  blockId?: string;
}

function parseLspOutput(output: string): {
  action: string;
  diagnostics: LspDiagnostic[];
  raw: string;
} {
  const lines = output.split("\n");
  let action = "";
  let jsonStart = 0;

  const headerMatch = lines[0]?.match(/^LSP action:\s*(.+)$/);
  if (headerMatch) {
    action = headerMatch[1];
    jsonStart = 1;
    while (jsonStart < lines.length && lines[jsonStart].trim() === "") jsonStart++;
  }

  const jsonStr = lines.slice(jsonStart).join("\n").trim();
  let diagnostics: LspDiagnostic[] = [];

  if (jsonStr.startsWith("[")) {
    try {
      diagnostics = JSON.parse(jsonStr) as LspDiagnostic[];
    } catch {
      // parse failed, keep empty
    }
  }

  return { action, diagnostics, raw: output };
}

function getSeverityIcon(severity?: number) {
  switch (severity) {
    case 1:
      return AlertCircle;
    case 2:
      return AlertTriangle;
    case 3:
      return Info;
    case 4:
      return Info;
    default:
      return AlertCircle;
  }
}

function getSeverityColor(severity?: number): string {
  switch (severity) {
    case 1:
      return "text-red-400";
    case 2:
      return "text-yellow-400";
    case 3:
      return "text-blue-400";
    case 4:
      return "text-gray-400";
    default:
      return "text-gray-400";
  }
}

export const LspExecutionCard = memo(function LspExecutionCard({ block }: LspExecutionCardProps) {
  const { t } = useTranslation("chat");
  const [collapsed, setCollapsed] = useState(false);

  const isRunning = block.status === "running";
  const isError = block.status === "error";

  const parsed = useMemo(() => parseLspOutput(block.output ?? ""), [block.output]);

  const hasDiagnostics = parsed.diagnostics.length > 0;
  const errorCount = parsed.diagnostics.filter((d) => d.severity === 1).length;
  const warnCount = parsed.diagnostics.filter((d) => d.severity === 2).length;

  const copyText = `[lsp] ${parsed.action}\n${block.output ?? ""}`;

  let bgClass: string;
  if (isRunning) bgClass = "bg-blue-950/15 dark:bg-blue-950/15";
  else if (isError) bgClass = "bg-red-950/10 dark:bg-red-950/10";
  else bgClass = "bg-amber-950/[0.06] dark:bg-gray-800/20";

  return (
    <div className={`overflow-hidden ${bgClass}`}>
      <div className="px-3 py-1 flex items-center gap-2 text-xs">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-0.5 text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors shrink-0"
          title={collapsed ? t("expandToolCard") : t("collapseToolCard")}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        <FileCode className="w-3 h-3 shrink-0 text-cyan-400" />

        <span className="font-medium text-cyan-300/90">
          lsp
          {parsed.action && (
            <span className="text-gray-500 font-normal ml-1">· {parsed.action}</span>
          )}
        </span>

        {!isRunning && hasDiagnostics && !collapsed && (
          <span className="ml-1.5 text-[10px] flex items-center gap-1">
            {errorCount > 0 && <span className="text-red-400">{errorCount}E</span>}
            {warnCount > 0 && <span className="text-yellow-400">{warnCount}W</span>}
            <span className="text-gray-500">{parsed.diagnostics.length} issues</span>
          </span>
        )}

        {isRunning && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}

        {!isRunning && !isError && (
          <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 ml-auto" />
        )}
        {isError && <span className="w-3.5 h-3.5 shrink-0 ml-auto text-red-400">✕</span>}

        <CopyButton text={copyText} size="xs" title={t("copyAllExecution")} />
      </div>

      {collapsed && (
        <div className="px-3 pb-2 text-[11px] text-gray-400 dark:text-gray-500 truncate">
          {hasDiagnostics
            ? `${parsed.diagnostics.length} diagnostics (${errorCount} errors, ${warnCount} warnings)`
            : (block.output?.split("\n")[0].slice(0, 80) ?? t("waitingOutput"))}
        </div>
      )}

      {!collapsed && (
        <div className="pb-2">
          {hasDiagnostics ? (
            <div className="px-3 pt-0.5 space-y-0.5">
              {parsed.diagnostics.map((diag, i) => {
                const Icon = getSeverityIcon(diag.severity);
                const color = getSeverityColor(diag.severity);
                const line = diag.range?.start?.line ?? 0;
                const char = diag.range?.start?.character ?? 0;

                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-1 px-2 rounded hover:bg-white/5 dark:hover:bg-white/[0.03] group"
                  >
                    <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className={`${color} font-mono tabular-nums shrink-0`}>
                          L{line}:{char}
                        </span>
                        {diag.source && (
                          <span className="text-gray-500 text-[10px] shrink-0">
                            [{diag.source}]
                          </span>
                        )}
                        {diag.code != null && (
                          <span className="text-gray-600 dark:text-gray-400 text-[10px] shrink-0">
                            ({String(diag.code)})
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-300 dark:text-gray-400 break-words">
                        {diag.message}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : isRunning ? (
            <div className="px-3 py-1 text-[11px] text-gray-400 italic">{t("waiting")}</div>
          ) : block.output ? (
            <pre className="mx-3 mt-0.5 text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto rounded px-2 py-1.5 bg-black/20">
              {block.output}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
});
