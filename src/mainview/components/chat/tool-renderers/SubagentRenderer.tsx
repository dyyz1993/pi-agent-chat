import { useCallback, memo, useState, useEffect, useRef } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentBlock, SubagentSessionInfo } from "../../../types";
import { getToolIcon } from "../tool-icon-map";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSettingsStore } from "../../../stores/use-settings-store";

type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

export const SubagentExecutionCard = memo(function SubagentExecutionCard({
  block,
  blockId,
}: {
  block: ToolExecBlock;
  blockId?: string;
}) {
  const { t } = useTranslation("chat");
  const isRunning = block.status === "running";
  const isError = block.status === "error";
  const isDone = block.status === "done";
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);

  const [collapsed, setCollapsed] = useState(false);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  let description = "";
  let instruction = "";
  try {
    const parsed = JSON.parse(block.args ?? "{}") as { description?: string; instruction?: string };
    description = parsed.description ?? "";
    instruction = parsed.instruction ?? "";
  } catch {
    /* args not valid JSON, use default */
  }

  const displayTitle = description || instruction.slice(0, 120) || t("subagent.subagentTask");

  const matchedSub = useSubagentStore((s): SubagentSessionInfo | null => {
    for (const subs of Object.values(s.subsessionsByParent)) {
      const found = subs.find(
        (sub) => sub.toolCallId === block.toolCallId || sub.description === description,
      );
      if (found) return found;
    }
    return null;
  });

  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  const handleViewSubagent = useCallback(() => {
    if (matchedSub && activeSessionId) {
      useSubagentStore.getState().setActiveSubsession(activeSessionId, matchedSub.sessionId);
    }
  }, [matchedSub, activeSessionId]);

  return (
    <div
      data-block-id={blockId}
      className={`cursor-pointer transition-colors ${
        isRunning
          ? "bg-purple-500/5 dark:bg-purple-400/5"
          : isError
            ? "bg-red-500/5 dark:bg-red-400/5"
            : "hover:bg-gray-200/40 dark:hover:bg-gray-800/40"
      }`}
      onClick={() => setCollapsed((c) => !c)}
    >
      <Header
        isRunning={isRunning}
        isError={isError}
        isDone={isDone}
        displayTitle={displayTitle}
        matchedSub={matchedSub}
        onView={handleViewSubagent}
        collapsed={collapsed}
      />

      {!collapsed && isRunning && <RunningInstruction instruction={instruction} />}

      {!collapsed && (block.output ?? (!isRunning && block.args)) && (
        <OutputSection block={block} isRunning={isRunning} />
      )}
    </div>
  );
});

export const Header = memo(function Header({
  isRunning,
  isError,
  isDone,
  displayTitle,
  matchedSub,
  onView,
  collapsed,
}: {
  isRunning: boolean;
  isError: boolean;
  isDone: boolean;
  displayTitle: string;
  matchedSub: SubagentSessionInfo | null;
  onView: () => void;
  collapsed?: boolean;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="px-3 py-1.5 flex items-start gap-2.5">
      <div
        className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
          isRunning
            ? "bg-purple-500/10 dark:bg-purple-400/10"
            : isError
              ? "bg-red-500/10 dark:bg-red-400/10"
              : "bg-purple-500/5 dark:bg-purple-400/5"
        }`}
      >
        {(() => {
          const { icon: BotIcon } = getToolIcon("subagent");
          return (
            <BotIcon
              className={`w-3.5 h-3.5 ${
                isRunning
                  ? "text-purple-600 dark:text-purple-400"
                  : isError
                    ? "text-red-500 dark:text-red-400"
                    : "text-purple-500 dark:text-purple-400/70"
              }`}
            />
          );
        })()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[11px] font-medium text-purple-700 dark:text-purple-300">
            SubAgent
          </span>
          <StatusChip isRunning={isRunning} isDone={isDone} isError={isError} />
          {collapsed && isRunning && (
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          )}
        </div>
        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2">
          {displayTitle}
        </p>
      </div>

      {isDone && matchedSub && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-500/10 transition-colors mt-1"
        >
          <ExternalLink className="w-3 h-3" />
          {t("subagent.view")}
        </button>
      )}
    </div>
  );
});

export const StatusChip = memo(function StatusChip({
  isRunning,
  isDone,
  isError,
}: {
  isRunning: boolean;
  isDone: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation("chat");
  if (isRunning) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] bg-purple-500/10 dark:bg-purple-400/15 text-purple-600 dark:text-purple-400">
        <span className="w-1 h-1 rounded-full bg-purple-600 dark:bg-purple-400 animate-pulse" />
        {t("subagent.running")}
      </span>
    );
  }
  if (isDone) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400">
        <span className="w-1 h-1 rounded-full bg-emerald-600 dark:bg-emerald-400" />
        {t("subagent.completed")}
      </span>
    );
  }
  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] bg-red-500/10 dark:bg-red-400/15 text-red-600 dark:text-red-400">
        {t("subagent.error")}
      </span>
    );
  }
  return null;
});

export const RunningInstruction = memo(function RunningInstruction({
  instruction,
}: {
  instruction: string;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="px-3 pb-2 pt-1">
      <div className="flex items-center gap-1.5 text-[11px] text-purple-500/70 dark:text-purple-400/60">
        <ArrowRight className="w-3 h-3 animate-pulse" />
        <span className="truncate">{instruction.slice(0, 200) || t("subagent.executing")}</span>
      </div>
    </div>
  );
});

export const OutputSection = memo(function OutputSection({
  block,
  isRunning,
}: {
  block: ToolExecBlock;
  isRunning: boolean;
}) {
  const { t } = useTranslation("chat");
  return (
    <details className="group">
      <summary className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400 select-none flex items-center gap-1.5">
        <svg
          className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4.5 3l3 3-3 3" />
        </svg>
        <span>{isRunning ? t("subagent.liveOutput") : t("subagent.output")}</span>
        {isRunning && (
          <span className="ml-auto text-purple-500/70 dark:text-purple-400/70 animate-pulse text-[11px]">
            {t("streaming")}
          </span>
        )}
      </summary>
      <div className="px-3 pb-2">
        {block.output ? (
          <pre className="text-[11px] text-gray-800 dark:text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-36 overflow-y-auto">
            {block.output}
          </pre>
        ) : (
          <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
            {t("subagent.noOutput")}
          </div>
        )}
      </div>
    </details>
  );
});
