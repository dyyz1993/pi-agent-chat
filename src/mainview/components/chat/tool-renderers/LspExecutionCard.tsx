import { memo, useMemo, Fragment } from "react";
import { CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ContentBlock } from "../../../types";
import { CopyButton } from "../CopyButton";
import { ToolCardHeader } from "../primitives/ToolCardHeader";
import type { ToolCardStatus } from "../primitives/ToolCardHeader";
import { useAutoCollapse } from "../../../hooks/use-auto-collapse";

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

const logger = createLogger("chat");

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
    } catch (e) {
      logger.warn("Failed to parse LSP diagnostics output", { error: String(e) });
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

function LspBadge({
  hasDiagnostics,
  errorCount,
  warnCount,
  totalIssues,
  isError,
  isRunning,
  copyText,
  copyTitle,
}: {
  hasDiagnostics: boolean;
  errorCount: number;
  warnCount: number;
  totalIssues: number;
  isError: boolean;
  isRunning: boolean;
  copyText: string;
  copyTitle: string;
}) {
  return (
    <Fragment>
      {!isRunning && hasDiagnostics && (
        <span className="text-[10px] flex items-center gap-1">
          {errorCount > 0 && <span className="text-status-error">{errorCount}E</span>}
          {warnCount > 0 && <span className="text-status-warning">{warnCount}W</span>}
          <span className="text-text-tertiary">{totalIssues} issues</span>
        </span>
      )}
      {!isRunning && !isError && (
        <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0" />
      )}
      {isError && <span className="w-3.5 h-3.5 shrink-0 text-status-error">✕</span>}
      <CopyButton text={copyText} size="xs" title={copyTitle} />
    </Fragment>
  );
}

export const LspExecutionCard = memo(function LspExecutionCard({ block }: LspExecutionCardProps) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";

  const [collapsed, setCollapsed] = useAutoCollapse(isRunning);
  const isError = block.status === "error";

  const parsed = useMemo(() => parseLspOutput(block.output ?? ""), [block.output]);

  const hasDiagnostics = parsed.diagnostics.length > 0;
  const errorCount = parsed.diagnostics.filter((d) => d.severity === 1).length;
  const warnCount = parsed.diagnostics.filter((d) => d.severity === 2).length;

  const copyText = `[lsp] ${parsed.action}\n${block.output ?? ""}`;

  const status: ToolCardStatus = isRunning ? "running" : isError ? "error" : "done";

  const firstOutputLine = block.output?.split("\n")[0]?.slice(0, 80).trim();
  const description = parsed.action ? parsed.action : firstOutputLine || t("waitingOutput");

  const badge = (
    <LspBadge
      hasDiagnostics={hasDiagnostics}
      errorCount={errorCount}
      warnCount={warnCount}
      totalIssues={parsed.diagnostics.length}
      isError={isError}
      isRunning={isRunning}
      copyText={copyText}
      copyTitle={t("copyAllExecution")}
    />
  );

  let bgClass: string;
  if (isRunning) bgClass = "bg-status-info/10";
  else if (isError) bgClass = "bg-status-error/5";
  else bgClass = "bg-status-warning/[0.05] dark:bg-surface-dim/50";

  return (
    <div className={`overflow-hidden ${bgClass}`}>
      <ToolCardHeader
        toolName="lsp_exec"
        status={status}
        description={description}
        collapsed={collapsed}
        onClick={() => setCollapsed(!collapsed)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={badge}
      />

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
