import { memo, useState, useEffect, useRef } from "react";
import { Zap, CheckCircle2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ContentBlock } from "../../../types";
import { useSettingsStore } from "../../../stores/use-settings-store";
import { ToolCardHeader } from "../primitives/ToolCardHeader";
import { InlineCodeViewer } from "./InlineCodeViewer";
import { formatFilePath } from "../../../lib/format-path";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("chat");

type RuleMatchStatus = "loaded" | "already_loaded" | "reloaded";

interface MatchedRuleDetail {
  name: string;
  title: string;
  severity: string;
  matchedGlob: string;
  status?: RuleMatchStatus;
  /** @deprecated Use status instead */
  alreadyLoaded?: boolean;
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

/** Resolve status from new status field or legacy alreadyLoaded boolean */
function getRuleStatus(rule: MatchedRuleDetail): RuleMatchStatus {
  if (rule.status) return rule.status;
  return rule.alreadyLoaded ? "already_loaded" : "loaded";
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
  const { t } = useTranslation("chat");

  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let filePath = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as { path?: string };
    filePath = parsed.path ?? "";
  } catch (e) {
    logger.warn("Failed to parse read file args", { error: String(e) });
  }

  const displayPath = filePath ? formatFilePath(filePath) : block.args?.slice(0, 80) || block.toolName;

  const headerStatus = isRunning
    ? ("running" as const)
    : isError
      ? ("error" as const)
      : ("done" as const);

  const rulesData = isRulesMatchedData(block.details) ? block.details : null;

  // Compute overall status across all rules
  const ruleStatuses = rulesData?.rulesMatched?.map(getRuleStatus) ?? [];
  const allAlreadyLoaded =
    ruleStatuses.length > 0 && ruleStatuses.every((s) => s === "already_loaded");
  const anyReloaded = ruleStatuses.some((s) => s === "reloaded");

  return (
    <div
      data-block-id={blockId}
      className={`border-x-0 border-t border-b overflow-hidden ${
        isRunning
          ? "border-status-info/25 bg-status-info/5"
          : isError
            ? "border-status-error/15 bg-status-error/5"
            : "border-border-secondary/30 bg-surface-dim"
      }`}
    >
      <ToolCardHeader
        toolName="read"
        status={headerStatus}
        description={displayPath}
        mono={true}
        rtl={true}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          isRunning ? (
            <span className="ml-auto text-[10px] text-status-info animate-pulse shrink-0">
              {t("readFile.reading")}
            </span>
          ) : undefined
        }
      />

      {collapsed ? null : (
        <>
          <details className="group" open>
            <summary className="sr-only">{t("expand")}</summary>
            <div className="px-3 pb-2">
              {block.output ? (
                <InlineCodeViewer code={block.output} filename={filePath} maxHeight="144px" />
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">
                  {t("readFile.readingProgress")}
                </div>
              ) : null}
            </div>
          </details>

          {rulesData && rulesData.rulesMatched && rulesData.rulesMatched.length > 0 && (
            <details className="group border-t border-semantic-accent/30">
              <summary className="px-3 py-1 text-[11px] text-semantic-accent cursor-pointer hover:text-semantic-accent select-none flex items-center gap-1.5">
                <svg
                  className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4.5 3l3 3-3 3" />
                </svg>
                {allAlreadyLoaded ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>{t("readFile.rulesAlreadyLoaded", "Rules already loaded")}</span>
                  </>
                ) : anyReloaded ? (
                  <>
                    <RefreshCw className="w-3 h-3 shrink-0" />
                    <span>{t("readFile.rulesReloaded", "Rules reloaded")}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3 shrink-0" />
                    <span>{t("readFile.rulesLoaded")}</span>
                  </>
                )}
                <span className="text-semantic-accent/80 ml-1">
                  {rulesData.rulesMatched.length} rule
                  {rulesData.rulesMatched.length !== 1 ? "s" : ""}
                </span>
              </summary>
              <div className="px-3 pb-2">
                {rulesData.rulesMatched.map((rule) => {
                  const status = getRuleStatus(rule);
                  return (
                    <div
                      key={rule.name}
                      className="border-b last:border-b-0 border-semantic-accent/20 py-1 flex items-center gap-1.5"
                    >
                      {status === "already_loaded" ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0 text-text-tertiary" />
                      ) : status === "reloaded" ? (
                        <RefreshCw className="w-3 h-3 shrink-0 text-status-warning" />
                      ) : (
                        <Zap className="w-3 h-3 shrink-0 text-semantic-accent" />
                      )}
                      <span
                        className={`text-[11px] font-medium shrink-0 ${rule.severity === "critical" ? "text-status-error" : rule.severity === "high" ? "text-status-warning" : status === "already_loaded" ? "text-text-tertiary" : "text-semantic-accent"}`}
                      >
                        {rule.title}
                      </span>
                      <span className="text-[11px] text-text-tertiary font-mono">
                        {rule.matchedGlob}
                      </span>
                      {status === "already_loaded" && (
                        <span className="text-[10px] text-text-tertiary italic ml-auto">
                          {t("readFile.alreadyLoaded", "loaded")}
                        </span>
                      )}
                      {status === "reloaded" && (
                        <span className="text-[10px] text-status-warning ml-auto">
                          {t("readFile.reloaded", "reloaded")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
});
