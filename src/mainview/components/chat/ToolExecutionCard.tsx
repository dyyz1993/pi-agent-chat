import { memo, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { CopyButton } from "./CopyButton";
import { ToolCardHeader } from "./primitives/ToolCardHeader";
import { UIInteractionAnchor } from "./tool-renderers/UICardRenderer";
import { tryFormatAsYaml } from "../../../shared/lib/json-to-yaml";
import { useSettingsStore } from "../../stores/use-settings-store";
import { getToolArgsDescription } from "../../lib/tool-args-description";
import type { ContentBlock, UIInteractionBlock } from "../../types";

interface HookDenialDetails {
  hookDenial: {
    reason: string;
    toolName: string;
    timestamp: number;
  };
}

function isHookDenial(details: unknown): details is HookDenialDetails {
  return (
    typeof details === "object" &&
    details !== null &&
    "hookDenial" in details &&
    typeof (details as HookDenialDetails).hookDenial?.reason === "string"
  );
}

export const ToolExecutionCard = memo(function ToolExecutionCard({
  block,
  blockId,
  uiBlock,
}: {
  block: Extract<ContentBlock, { type: "toolExecution" }>;
  blockId: string;
  uiBlock?: UIInteractionBlock;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const [inputOpen, setInputOpen] = useState(false);
  const [outputOpen, setOutputOpen] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);
  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let bgOnly: string;
  if (isRunning) {
    bgOnly = "bg-status-info/[0.10]";
  } else if (isError) {
    bgOnly = "bg-status-error/[0.08]";
  } else {
    bgOnly = "bg-surface-dim/60 dark:bg-surface-dim/20";
  }

  const fullExecutionText = useMemo(() => {
    return `[${t("toolCall")}] ${block.toolName}\n${t("input")}:\n${tryFormatAsYaml(block.args ?? "")}\n${t("output")}:\n${block.output ?? ""}`;
  }, [block.toolName, block.args, block.output]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      if (!prev && cardRef.current) {
        cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return !prev;
    });
  }, []);

  return (
    <div ref={cardRef} className={`overflow-hidden ${bgOnly}`} data-block-id={blockId}>
      <ToolCardHeader
        toolName={block.toolName}
        status={isRunning ? "running" : isError ? "error" : "done"}
        description={
          block.output && !isRunning
            ? (() => {
                const firstLine = block.output.split("\n")[0].slice(0, 100);
                const trimmed = firstLine.trim();
                // If output starts with JSON brace, skip it — use args-based description instead.
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                  return (
                    block.description ??
                    getToolArgsDescription(block.toolName, block.args) ??
                    block.toolName
                  );
                }
                return firstLine;
              })()
            : (block.description ??
              getToolArgsDescription(block.toolName, block.args) ??
              block.toolName)
        }
        collapsed={collapsed}
        onClick={handleToggleCollapse}
        startedAt={block.startedAt}
        endedAt={block.endedAt}
        badge={
          <>
            {!isRunning && !isError && (
              <CheckCircle className="w-3.5 h-3.5 text-status-success shrink-0" />
            )}
            {isError && <XCircle className="w-3.5 h-3.5 text-status-error shrink-0" />}
            <CopyButton text={fullExecutionText} size="xs" title={t("copyAllExecution")} />
          </>
        }
      />

      {!collapsed && (
        <>
          <div
            className="px-3 py-1 text-[11px] text-text-secondary cursor-pointer hover:text-text-primary dark:hover:text-text-primary select-none flex items-center gap-1.5"
            onClick={() => setInputOpen(!inputOpen)}
          >
            <svg
              className={`w-3 h-3 transition-transform shrink-0 ${inputOpen ? "rotate-90" : ""}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4.5 3l3 3-3 3" />
            </svg>
            <span>Input</span>
            {block.args && (
              <CopyButton
                text={typeof block.args === "string" ? block.args : JSON.stringify(block.args)}
                size="xs"
                className="ml-auto"
                title={t("copyInput")}
              />
            )}
          </div>
          {inputOpen && block.args && (
            <div className="px-3 pb-2 pt-0.5">
              <pre className="text-[11px] text-status-warning/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
                {tryFormatAsYaml(block.args)}
              </pre>
            </div>
          )}

          <div
            className="px-3 py-1 text-[11px] text-text-secondary cursor-pointer hover:text-text-primary dark:hover:text-text-primary select-none flex items-center gap-1.5"
            onClick={() => setOutputOpen(!outputOpen)}
          >
            <svg
              className={`w-3 h-3 transition-transform shrink-0 ${outputOpen ? "rotate-90" : ""}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4.5 3l3 3-3 3" />
            </svg>
            <span>Output</span>
            {isRunning && (
              <span className="ml-auto text-status-info/70 animate-pulse text-[10px]">
                streaming
              </span>
            )}
            {block.output && !isRunning && (
              <CopyButton
                text={block.output}
                size="xs"
                className="ml-auto"
                title={t("copyOutput")}
              />
            )}
          </div>
          {outputOpen && (
            <div className="px-3 pb-2 pt-0.5">
              {uiBlock && uiBlock.status === "pending" ? (
                <UIInteractionAnchor block={uiBlock} />
              ) : block.output ? (
                <pre className="text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto bg-surface-code/80 dark:bg-surface-code/30 rounded px-2 py-1.5">
                  {block.output}
                </pre>
              ) : isRunning ? (
                <div className="text-[11px] text-text-tertiary italic py-1">{t("waiting")}</div>
              ) : null}
            </div>
          )}

          {isError && isHookDenial(block.details) && (
            <details className="group border-t border-status-error/20" open>
              <summary className="px-3 py-1 text-[11px] text-status-error cursor-pointer hover:text-status-error select-none flex items-center gap-1.5">
                <svg
                  className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4.5 3l3 3-3 3" />
                </svg>
                <AlertTriangle className="w-3 h-3 shrink-0" />
                <span>{t("hookDenied")}</span>
              </summary>
              <div className="px-3 pb-2">
                <div className="text-[11px] text-status-error/90">
                  {(block.details as HookDenialDetails).hookDenial.reason}
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
});
