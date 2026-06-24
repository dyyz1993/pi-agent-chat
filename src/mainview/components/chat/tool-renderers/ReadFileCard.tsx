import { memo } from "react";
import { useTranslation } from "react-i18next";
import { createLogger } from "../../../../shared/lib/logger";
import type { ContentBlock } from "../../../types";
import { ToolCardHeader } from "../primitives/ToolCardHeader";
import { InlineCodeViewer } from "./InlineCodeViewer";
import { formatToolHeaderPath, useKnownProjectRoots } from "../../../lib/format-path";
import { useAutoCollapse } from "../../../hooks/use-auto-collapse";
import { ContextReferenceCard, type ContextReference } from "../ContextReferenceCard";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

const logger = createLogger("chat");

type RuleMatchStatus = "loaded" | "already_loaded" | "reloaded";

interface MatchedRuleDetail {
  name: string;
  title: string;
  severity: string;
  matchedGlob: string;
  source?: string;
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
  const projectRoots = useKnownProjectRoots();

  const [collapsed, setCollapsed] = useAutoCollapse(isRunning);

  let filePath = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as { path?: string };
    filePath = parsed.path ?? "";
  } catch (e) {
    logger.warn("Failed to parse read file args", { error: String(e) });
  }

  const displayPath = filePath
    ? formatToolHeaderPath(filePath, projectRoots)
    : block.args?.slice(0, 80) || block.toolName;

  const headerStatus = isRunning
    ? ("running" as const)
    : isError
      ? ("error" as const)
      : ("done" as const);

  const rulesData = isRulesMatchedData(block.details) ? block.details : null;

  const ruleReferences: ContextReference[] =
    rulesData?.rulesMatched?.map((rule, index) => {
      const status = getRuleStatus(rule);
      return {
        id: `rule:${rule.name}:${index}`,
        kind: "rule",
        title: rule.title,
        subtitle: rule.matchedGlob,
        path: rule.source,
        status,
        detail: rule.name,
      };
    }) ?? [];

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
        onClick={() => setCollapsed(!collapsed)}
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
            <div className="border-t border-border-secondary/30">
              <ContextReferenceCard references={ruleReferences} />
            </div>
          )}
        </>
      )}
    </div>
  );
});
