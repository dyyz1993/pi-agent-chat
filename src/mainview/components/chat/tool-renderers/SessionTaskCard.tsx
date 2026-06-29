import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { ToolCardHeader, type ToolCardStatus } from "../primitives/ToolCardHeader";
import { CopyButton } from "../CopyButton";
import { CachedReactMarkdown } from "../CachedReactMarkdown";
import { useSettingsStore } from "../../../stores/use-settings-store";
import {
  SessionActivitySummary,
  type SessionActivityLabels,
  type SessionActivityRound,
} from "./SessionActivitySummary";

export const SESSION_TASK_MARKDOWN_CLASS =
  "text-[11px] text-text-primary prose dark:prose-invert prose-sm max-w-none max-h-64 overflow-y-auto prose-p:my-1 prose-pre:my-1 prose-headings:my-1 prose-headings:text-text-primary dark:prose-headings:text-text-primary prose-strong:text-text-primary dark:prose-strong:text-text-primary prose-code:text-text-primary dark:prose-code:text-text-primary";

interface SessionTaskTextSection {
  label: string;
  text: string;
  copyText?: string;
}

interface SessionTaskActivitySection {
  title: string;
  rounds: SessionActivityRound[];
  live: boolean;
  labels: SessionActivityLabels;
}

interface SessionTaskCardProps {
  blockId?: string;
  toolName: string;
  status: ToolCardStatus;
  title: ReactNode;
  badge?: ReactNode;
  time?: ReactNode;
  startedAt?: number;
  endedAt?: number;
  meta?: string[];
  input?: SessionTaskTextSection;
  activity?: SessionTaskActivitySection;
  result?: SessionTaskTextSection;
  error?: SessionTaskTextSection;
  details?: SessionTaskTextSection;
}

function shellClass(status: ToolCardStatus): string {
  if (status === "running") {
    return "border-status-info/25 bg-status-info/5 dark:bg-status-info/10";
  }
  if (status === "error" || status === "terminated") {
    return "border-status-error/20 bg-status-error/10 dark:bg-status-error/15";
  }
  return "border-border-secondary/30 bg-surface-dim";
}

function TextSection({
  section,
  kind,
}: {
  section: SessionTaskTextSection;
  kind: "input" | "result" | "error";
}) {
  const isResult = kind === "result";
  const isError = kind === "error";
  const textColor = isError
    ? "text-status-error/90"
    : isResult
      ? "text-text-primary"
      : "text-status-info/80";

  return (
    <div
      className={`px-3 py-2 border-b ${
        isError ? "border-status-error/20" : "border-border-secondary/20"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div
          className={`text-[10px] select-none ${
            isError ? "text-status-error" : "text-text-tertiary"
          }`}
        >
          {section.label}
        </div>
        {section.copyText !== undefined && <CopyButton text={section.copyText} size="xs" />}
      </div>
      {isResult ? (
        <div className={SESSION_TASK_MARKDOWN_CLASS}>
          <CachedReactMarkdown>{section.text}</CachedReactMarkdown>
        </div>
      ) : isError ? (
        <pre className={`text-[11px] whitespace-pre-wrap font-mono ${textColor}`}>
          {section.text}
        </pre>
      ) : (
        <div className={`text-[11px] whitespace-pre-wrap leading-relaxed ${textColor}`}>
          {section.text}
        </div>
      )}
    </div>
  );
}

export const SessionTaskCard = memo(function SessionTaskCard({
  blockId,
  toolName,
  status,
  title,
  badge,
  time,
  startedAt,
  endedAt,
  meta,
  input,
  activity,
  result,
  error,
  details,
}: SessionTaskCardProps) {
  const isRunning = status === "running";
  const collapseToolCards = useSettingsStore((s) => s.collapseToolCards);
  const [collapsed, setCollapsed] = useState(() => !isRunning && collapseToolCards);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && collapseToolCards) {
      setCollapsed(true);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, collapseToolCards]);

  return (
    <div
      data-block-id={blockId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b transition-colors ${shellClass(
        status,
      )}`}
    >
      <ToolCardHeader
        toolName={toolName}
        status={status}
        description={title}
        collapsed={collapsed}
        onClick={() => setCollapsed((c) => !c)}
        startedAt={startedAt}
        endedAt={endedAt}
        time={time}
        badge={badge}
      />

      {!collapsed && (
        <div className="border-t border-border-secondary/20">
          {meta && meta.length > 0 && (
            <div className="px-3 py-1.5 text-[10px] text-text-tertiary flex flex-wrap gap-x-2 gap-y-1 border-b border-border-secondary/20">
              {meta.map((item) => (
                <span key={item} className="font-mono truncate max-w-full">
                  {item}
                </span>
              ))}
            </div>
          )}

          {input && <TextSection section={input} kind="input" />}
          {activity && (
            <SessionActivitySummary
              title={activity.title}
              rounds={activity.rounds}
              live={activity.live}
              labels={activity.labels}
            />
          )}
          {result && <TextSection section={result} kind="result" />}
          {error && <TextSection section={error} kind="error" />}

          {details && (
            <details className="group">
              <summary className="px-3 py-1.5 text-[11px] text-text-tertiary cursor-pointer hover:text-text-primary select-none">
                {details.label}
              </summary>
              <pre className="px-3 pb-2 text-[11px] text-text-secondary overflow-x-auto whitespace-pre-wrap font-mono max-h-44 overflow-y-auto">
                {details.text}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
});
