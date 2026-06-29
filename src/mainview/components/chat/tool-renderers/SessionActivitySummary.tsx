import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage, ContentBlock, ToolExecutionStatus } from "../../../types";
import { summarizeActivityText } from "../../../lib/activity-summary-text";

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
  summarySource: "content" | "tools" | "thinking";
  tools: SessionActivityTool[];
}

export interface SessionActivityLabels {
  running: string;
  completed: string;
  error: string;
  pending: string;
  thinking: string;
}

interface BuildActivityRoundsOptions {
  forceTerminal?: boolean;
}

interface SessionActivitySummaryProps {
  title: string;
  rounds: SessionActivityRound[];
  live: boolean;
  labels: SessionActivityLabels;
  maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 8;
const MAX_SUMMARY_CHARS = 160;
const MAX_VISIBLE_TOOL_NAMES = 3;
const MAX_TOOL_SUMMARY_CHARS = 64;

function compactText(text: string, max = MAX_SUMMARY_CHARS): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function collectTextCandidates(block: ContentBlock): string[] {
  if (block.type !== "text") return [];
  return block.text
    .split(/\n+/)
    .map((line) => compactText(line, MAX_SUMMARY_CHARS))
    .filter(Boolean);
}

function uniqueToolNames(tools: SessionActivityTool[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    names.push(tool.name);
  }
  return names;
}

function buildInlineToolSummary(tools: SessionActivityTool[]): string {
  const names = uniqueToolNames(tools);
  if (names.length === 0) return "";
  const visible = names.slice(0, MAX_VISIBLE_TOOL_NAMES);
  const extraCount = Math.max(0, names.length - visible.length);
  const summary = visible.join(" · ");
  const withExtra = extraCount > 0 ? `${summary} +${extraCount}` : summary;
  return compactText(withExtra, MAX_TOOL_SUMMARY_CHARS);
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

export function buildActivityRoundsFromMessages(
  messages: ChatMessage[],
  labels: SessionActivitySummaryProps["labels"],
  maxRounds = DEFAULT_MAX_ROUNDS,
  options?: BuildActivityRoundsOptions,
): SessionActivityRound[] {
  const forceTerminal = options?.forceTerminal ?? false;
  const rounds: SessionActivityRound[] = [];
  const lastAssistantMessageIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (message.role !== "assistant" && message.role !== "custom") continue;

    const tools: SessionActivityTool[] = [];
    const textCandidates: string[] = [];
    let hasThinking = false;

    message.content.forEach((block, index) => {
      if (block.type === "toolExecution") {
        let status = normalizeToolStatus(block.status);
        if (forceTerminal && status === "running") {
          status = "done";
        }
        if (
          status === "running" &&
          !message.isStreaming &&
          lastAssistantMessageIndex > messageIndex
        ) {
          status = "done";
        }
        tools.push({
          id: block.toolCallId || `${message.id}-${index}`,
          name: block.toolName || "tool",
          status,
        });
        return;
      }

      if (block.type === "thinking") hasThinking = true;
      textCandidates.push(...collectTextCandidates(block));
    });

    const hasError = tools.some((tool) => tool.status === "error");
    const hasRunning =
      !forceTerminal && ((message.isStreaming ?? false) || tools.some((tool) => tool.status === "running"));
    const status: SessionActivityStatus = hasError ? "error" : hasRunning ? "running" : "done";
    const toolText = buildInlineToolSummary(tools);
    const latestText =
      textCandidates.length > 0 ? summarizeActivityText(textCandidates, MAX_SUMMARY_CHARS) : "";
    let summary = "";
    let summarySource: SessionActivityRound["summarySource"] = "thinking";
    if (latestText) {
      summary = latestText;
      summarySource = "content";
    } else if (toolText) {
      summary = compactText(toolText);
      summarySource = "tools";
    } else if (hasThinking) {
      summary = labels.thinking;
      summarySource = "thinking";
    }

    if (!summary && tools.length === 0) continue;

    rounds.push({
      id: message.id || `activity-round-${message.timestamp}-${rounds.length}`,
      index: rounds.length + 1,
      status,
      summary,
      summarySource,
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollSignature = useMemo(
    () =>
      visibleRounds
        .map((round) => {
          const toolSig = round.tools.map((tool) => `${tool.id}:${tool.status}`).join(",");
          return `${round.id}:${round.status}:${round.summary ?? ""}:${toolSig}`;
        })
        .join("|"),
    [visibleRounds],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !shouldStickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollSignature, showLivePlaceholder]);

  if (visibleRounds.length === 0 && !showLivePlaceholder) return null;

  return (
    <div className="px-3 py-2 border-t border-border-secondary/20">
      <div className="text-[10px] text-text-tertiary mb-1 select-none">{title}</div>
      <div
        ref={scrollRef}
        className="max-h-44 overflow-y-auto overscroll-contain pr-1 space-y-1 [scrollbar-gutter:stable]"
        onScroll={(event) => {
          const el = event.currentTarget;
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          shouldStickToBottomRef.current = distanceFromBottom < 12;
        }}
      >
        {visibleRounds.map((round) => {
          const summary =
            round.summary && round.summary.length > 0 ? round.summary : labels.thinking;
          const toolSummary = buildInlineToolSummary(round.tools);

          return (
            <div
              key={round.id}
              className="rounded border border-border-secondary/20 bg-surface-elevated/30 px-2 py-1.5"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <span className="shrink-0 text-text-tertiary tabular-nums">#{round.index}</span>
                <span className={`shrink-0 ${statusClass(round.status)}`}>
                  {statusLabel(round.status, labels)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-secondary">
                  {summary}
                </span>
                {toolSummary && round.summarySource !== "tools" && (
                  <span
                    className={`shrink-0 max-w-[40%] truncate rounded border px-1.5 py-0.5 font-mono text-[10px] ${toolClass(
                      round.status,
                    )}`}
                    title={uniqueToolNames(round.tools).join(" · ")}
                  >
                    {toolSummary}
                  </span>
                )}
              </div>
            </div>
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
