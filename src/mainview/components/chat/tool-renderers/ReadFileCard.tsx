import { memo, useState, useEffect, useRef } from "react";
import { Zap, CheckCircle2, RefreshCw } from "lucide-react";
import { getToolIcon } from "../tool-icon-map";
import { useTranslation } from "react-i18next";
import type { ContentBlock } from "../../../types";
import { useSettingsStore } from "../../../stores/use-settings-store";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

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
  const [collapsed, setCollapsed] = useState(false);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (isRunning) {
      setCollapsed(false);
    } else if (wasRunningRef.current && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let filePath = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as { path?: string };
    filePath = parsed.path ?? "";
  } catch {
    /* args not valid JSON, use default */
  }

  const displayPath = filePath || block.args?.slice(0, 80) || "";
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
          ? "border-blue-500/25 bg-blue-50 dark:bg-blue-950/20"
          : isError
            ? "border-red-500/15 bg-red-50 dark:bg-red-950/15"
            : "border-gray-200 dark:border-gray-700/30 bg-gray-50 dark:bg-gray-800/25"
      }`}
    >
      <div
        className="px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800/40 transition-colors select-none"
        onClick={() => !isRunning && setCollapsed((c) => !c)}
        role={isRunning ? undefined : "button"}
        aria-expanded={isRunning ? undefined : !collapsed}
      >
        {!isRunning && (
          <svg
            className={`w-3 h-3 transition-transform shrink-0 ${collapsed ? "" : "rotate-90"}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4.5 3l3 3-3 3" />
          </svg>
        )}
        {(() => {
          const { icon: ReadIcon } = getToolIcon("read");
          return (
            <ReadIcon
              className={`w-3.5 h-3.5 shrink-0 ${isRunning ? "text-blue-500 dark:text-blue-400" : isError ? "text-red-500 dark:text-red-400" : "text-blue-500/70 dark:text-blue-400/60"}`}
            />
          );
        })()}
        <span className="min-w-0 text-gray-800 dark:text-gray-300 font-mono" title={displayPath}>
          <span className="block truncate rtl" style={{ direction: "rtl", textAlign: "left" }}>
            <span style={{ direction: "ltr", display: "inline" }}>{displayPath}</span>
          </span>
        </span>
        {isRunning && (
          <span className="ml-auto text-[10px] text-blue-500 dark:text-blue-400 animate-pulse shrink-0">
            {t("readFile.reading")}
          </span>
        )}
      </div>

      {collapsed ? null : (
        <>
          <details className="group" open>
            <summary className="sr-only">{t("expand")}</summary>
            <div className="px-3 pb-2">
              {block.output ? (
                <pre className="text-[11px] text-gray-800 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-gray-100 dark:bg-gray-900/40 rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
                  {t("readFile.readingProgress")}
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
                <span className="text-indigo-500 dark:text-indigo-600 ml-1">
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
                      className="border-b last:border-b-0 border-indigo-200/20 dark:border-indigo-700/10 py-1 flex items-center gap-1.5"
                    >
                      {status === "already_loaded" ? (
                        <CheckCircle2 className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" />
                      ) : status === "reloaded" ? (
                        <RefreshCw className="w-3 h-3 shrink-0 text-amber-500 dark:text-amber-400" />
                      ) : (
                        <Zap className="w-3 h-3 shrink-0 text-indigo-500 dark:text-indigo-400" />
                      )}
                      <span
                        className={`text-[11px] font-medium shrink-0 ${rule.severity === "critical" ? "text-red-500 dark:text-red-400" : rule.severity === "high" ? "text-amber-600 dark:text-amber-400" : status === "already_loaded" ? "text-gray-500 dark:text-gray-400" : "text-indigo-700 dark:text-indigo-300"}`}
                      >
                        {rule.title}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-600 font-mono">
                        {rule.matchedGlob}
                      </span>
                      {status === "already_loaded" && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-600 italic ml-auto">
                          {t("readFile.alreadyLoaded", "loaded")}
                        </span>
                      )}
                      {status === "reloaded" && (
                        <span className="text-[10px] text-amber-500 dark:text-amber-400 ml-auto">
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
