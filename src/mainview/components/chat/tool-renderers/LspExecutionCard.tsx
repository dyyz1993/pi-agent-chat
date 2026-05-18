import { memo, useState, useMemo, useEffect, useRef } from "react";
import { CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock } from "../../../types";
import { getToolIcon } from "../tool-icon-map";
import { CopyButton } from "../CopyButton";
import { useSettingsStore } from "../../../stores/use-settings-store";

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
      return "text-status-error";
    case 2:
      return "text-status-warning";
    case 3:
      return "text-status-info";
    case 4:
      return "text-text-tertiary";
    default:
      return "text-text-tertiary";
  }
}

export const LspExecutionCard = memo(function LspExecutionCard({ block }: LspExecutionCardProps) {
  const { t } = useTranslation("chat");
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const isRunning = block.status === "running";

  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);
  const isError = block.status === "error";

  const parsed = useMemo(() => parseLspOutput(block.output ?? ""), [block.output]);

  const hasDiagnostics = parsed.diagnostics.length > 0;
  const errorCount = parsed.diagnostics.filter((d) => d.severity === 1).length;
  const warnCount = parsed.diagnostics.filter((d) => d.severity === 2).length;

  const copyText = `[lsp] ${parsed.action}\n${block.output ?? ""}`;

  let bgClass: string;
  if (isRunning) bgClass = "bg-status-info/10";
  else if (isError) bgClass = "bg-status-error/5";
  else bgClass = "bg-status-warning/[0.05] dark:bg-surface-dim/50";

  return (
    <div className={`overflow-hidden ${bgClass}`}>
      <div
        className="px-3 py-1 flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-hover transition-colors select-none"
        onClick={() => setCollapsed((c) => !c)}
        role="button"
        aria-expanded={!collapsed}
      >
        {collapsed && isRunning && (
          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
        )}

        {(() => {
          const { icon: LspIcon } = getToolIcon("lsp_exec");
          return <LspIcon className="w-3 h-3 shrink-0 text-semantic-tool" />;
        })()}

        <span className="font-medium text-semantic-tool/90">
          lsp
          {parsed.action && (
            <span className="text-text-tertiary font-normal ml-1">· {parsed.action}</span>
          )}
        </span>

        {!isRunning && hasDiagnostics && !collapsed && (
          <span className="ml-1.5 text-[10px] flex items-center gap-1">
            {errorCount > 0 && <span className="text-status-error">{errorCount}E</span>}
            {warnCount > 0 && <span className="text-status-warning">{warnCount}W</span>}
            <span className="text-text-tertiary">{parsed.diagnostics.length} issues</span>
          </span>
        )}

        {isRunning && <span className="text-status-info animate-pulse text-[10px]">running</span>}

        {!isRunning && !isError && (
          <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0 ml-auto" />
        )}
        {isError && <span className="w-3.5 h-3.5 shrink-0 ml-auto text-status-error">✕</span>}

        <CopyButton text={copyText} size="xs" title={t("copyAllExecution")} />
      </div>

      {collapsed ? (
        <div className="px-3 pb-2 text-[11px] text-text-tertiary truncate">
          {hasDiagnostics
            ? `${parsed.diagnostics.length} diagnostics (${errorCount} errors, ${warnCount} warnings)`
            : (block.output?.split("\n")[0].slice(0, 80) ?? t("waitingOutput"))}
        </div>
      ) : (
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
                    className="flex items-start gap-2 py-1 px-2 rounded hover:bg-white/5 dark:hover:bg-white/5 group"
                  >
                    <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className={`${color} font-mono tabular-nums shrink-0`}>
                          L{line}:{char}
                        </span>
                        {diag.source && (
                          <span className="text-text-tertiary text-[10px] shrink-0">
                            [{diag.source}]
                          </span>
                        )}
                        {diag.code != null && (
                          <span className="text-text-secondary text-[10px] shrink-0">
                            ({String(diag.code)})
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-text-secondary break-words">
                        {diag.message}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : isRunning ? (
            <div className="px-3 py-1 text-[11px] text-text-tertiary italic">{t("waiting")}</div>
          ) : block.output ? (
            <pre className="mx-3 mt-0.5 text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto rounded px-2 py-1.5 bg-black/20">
              {block.output}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
});
