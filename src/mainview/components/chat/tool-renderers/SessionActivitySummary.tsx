import type { ChatMessage, ContentBlock, ToolExecutionStatus } from "../../../types";

export type SessionActivityStatus = "running" | "done" | "error";

export interface SessionActivityTool {
  id: string;
  name: string;
  status: SessionActivityStatus;
}

export interface SessionActivityRound {
  id: string;
  index: number;
  status: SessionActivityStatus;
  summary?: string;
  tools: SessionActivityTool[];
}

export interface SessionActivityLabels {
  running: string;
  completed: string;
  error: string;
  pending: string;
  thinking: string;
}

interface SessionActivitySummaryProps {
  title: string;
  rounds: SessionActivityRound[];
  live: boolean;
  labels: SessionActivityLabels;
  maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 8;
const MAX_SUMMARY_CHARS = 220;

function compactText(text: string, max = MAX_SUMMARY_CHARS): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function normalizeToolStatus(status: ToolExecutionStatus): SessionActivityStatus {
  if (status === "error") return "error";
  if (status === "running" || status === "background") return "running";
  return "done";
}

function statusClass(status: SessionActivityStatus): string {
  if (status === "running") return "text-status-info";
  if (status === "error") return "text-status-error";
  return "text-status-success";
}

function toolClass(status: SessionActivityStatus): string {
  if (status === "running") {
    return "border-status-info/20 text-status-info bg-status-info/10";
  }
  if (status === "error") {
    return "border-status-error/20 text-status-error bg-status-error/10";
  }
  return "border-status-success/20 text-status-success bg-status-success/10";
}

function statusLabel(status: SessionActivityStatus, labels: SessionActivitySummaryProps["labels"]) {
  if (status === "running") return labels.running;
  if (status === "error") return labels.error;
  return labels.completed;
}

export function createSessionActivityLabels(t: (key: string) => string): SessionActivityLabels {
  return {
    running: t("coordinator.running"),
    completed: t("coordinator.completed"),
    error: t("coordinator.error"),
    pending: t("coordinator.waitingNextEvent"),
    thinking: t("coordinator.thinking"),
  };
}

function textFromBlock(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "custom") return block.customType.replace(/_/g, " ");
  return "";
}

export function buildActivityRoundsFromMessages(
  messages: ChatMessage[],
  labels: SessionActivitySummaryProps["labels"],
  maxRounds = DEFAULT_MAX_ROUNDS,
): SessionActivityRound[] {
  const rounds: SessionActivityRound[] = [];

  for (const message of messages) {
    if (message.role !== "assistant" && message.role !== "custom") continue;

    const tools: SessionActivityTool[] = [];
    const textParts: string[] = [];
    let hasThinking = false;

    message.content.forEach((block, index) => {
      if (block.type === "toolExecution") {
        tools.push({
          id: block.toolCallId || `${message.id}-${index}`,
          name: block.toolName || "tool",
          status: normalizeToolStatus(block.status),
        });
        return;
      }

      if (block.type === "thinking") hasThinking = true;
      const text = textFromBlock(block);
      if (text.trim()) textParts.push(text);
    });

    const hasError = tools.some((tool) => tool.status === "error");
    const hasRunning = message.isStreaming || tools.some((tool) => tool.status === "running");
    const status: SessionActivityStatus = hasError ? "error" : hasRunning ? "running" : "done";
    const toolText = tools.map((tool) => tool.name).join(" · ");
    const summary =
      compactText(textParts.join(" ")) ||
      compactText(toolText) ||
      (hasThinking ? labels.thinking : "");

    if (!summary && tools.length === 0) continue;

    rounds.push({
      id: message.id,
      index: rounds.length + 1,
      status,
      summary,
      tools,
    });
  }

  return rounds.slice(-maxRounds).map((round, index) => ({ ...round, index: index + 1 }));
}

export function SessionActivitySummary({
  title,
  rounds,
  live,
  labels,
  maxRounds = DEFAULT_MAX_ROUNDS,
}: SessionActivitySummaryProps) {
  const visibleRounds = rounds.slice(-maxRounds);
  const hasRunningRound = visibleRounds.some((round) => round.status === "running");
  const showLivePlaceholder = live && !hasRunningRound;
  if (visibleRounds.length === 0 && !showLivePlaceholder) return null;

  return (
    <div className="px-3 py-2 border-t border-border-secondary/20">
      <div className="text-[10px] text-text-tertiary mb-1 select-none">{title}</div>
      <div className="max-h-44 overflow-y-auto overscroll-contain pr-1 space-y-1 [scrollbar-gutter:stable]">
        {visibleRounds.map((round) => {
          const visibleTools = round.tools.slice(0, 4);
          const extraTools = Math.max(0, round.tools.length - visibleTools.length);
          const summary = round.summary || visibleTools.map((tool) => tool.name).join(" · ");
          const hasToolDetails = round.tools.length > 0;

          return (
            <details
              key={round.id}
              className="group rounded border border-border-secondary/20 bg-surface-elevated/30"
              open={round.status === "running"}
            >
              <summary className="list-none cursor-pointer px-2 py-1.5 flex items-center gap-2 text-[11px] hover:bg-surface-hover/40">
                <span className="shrink-0 text-text-tertiary tabular-nums">#{round.index}</span>
                <span className={`shrink-0 ${statusClass(round.status)}`}>
                  {statusLabel(round.status, labels)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-secondary">
                  {summary || labels.thinking}
                </span>
                {extraTools > 0 && (
                  <span className="shrink-0 text-[10px] text-text-tertiary">+{extraTools}</span>
                )}
              </summary>
              {hasToolDetails && (
                <div className="px-2 pb-2 flex flex-wrap gap-1">
                  {round.tools.map((tool) => (
                    <span
                      key={tool.id}
                      className={`px-1.5 py-0.5 rounded text-[10px] border ${toolClass(
                        tool.status,
                      )}`}
                    >
                      {tool.name}
                    </span>
                  ))}
                </div>
              )}
            </details>
          );
        })}
        {showLivePlaceholder && (
          <div className="rounded border border-status-info/20 bg-status-info/10 px-2 py-1.5 flex items-center gap-2 text-[11px]">
            <span className="shrink-0 text-text-tertiary tabular-nums">
              #{visibleRounds.length + 1}
            </span>
            <span className="shrink-0 text-status-info animate-pulse">{labels.running}</span>
            <span className="min-w-0 flex-1 truncate text-text-secondary">{labels.pending}</span>
          </div>
        )}
      </div>
    </div>
  );
}
