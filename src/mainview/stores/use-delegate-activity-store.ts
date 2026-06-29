import { create } from "zustand";
import { summarizeActivityText } from "../lib/activity-summary-text";

type DelegateActivityStatus = "running" | "done" | "error";

export interface DelegateActivityTool {
  toolCallId: string;
  toolName: string;
  status: DelegateActivityStatus;
}

export interface DelegateActivityRound {
  id: string;
  index: number;
  status: DelegateActivityStatus;
  startedAt: number;
  endedAt?: number;
  summary?: string;
  tools: DelegateActivityTool[];
}

export interface DelegateActivity {
  sessionId: string;
  status: DelegateActivityStatus;
  rounds: DelegateActivityRound[];
  updatedAt: number;
}

interface DelegateActivityState {
  bySession: Record<string, DelegateActivity>;
  handleEvent: (sessionId: string, event: unknown) => void;
  clearSession: (sessionId: string) => void;
}

const MAX_ROUNDS = 8;
const MAX_SUMMARY_CHARS = 220;

function eventType(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const type = (event as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function extractTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

function extractMessageText(event: Record<string, unknown>): string {
  const message = event.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  return summarizeActivityText(extractTextFromContent(content), MAX_SUMMARY_CHARS);
}

function getMessageRole(event: Record<string, unknown>): string | undefined {
  const message = event.message;
  if (!message || typeof message !== "object") return undefined;
  const role = (message as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function getCustomType(event: Record<string, unknown>): string | undefined {
  const message = event.message;
  if (!message || typeof message !== "object") return undefined;
  const customType = (message as Record<string, unknown>).customType;
  return typeof customType === "string" ? customType : undefined;
}

function summarizeCustomEvent(customType: string | undefined): {
  summary: string;
  status: DelegateActivityStatus;
} | null {
  switch (customType) {
    case "memory_prefetch":
      return { summary: "正在搜索记忆", status: "running" };
    case "memory_prefetch_result":
      return { summary: "记忆搜索完成", status: "done" };
    case "rules-engine":
      return { summary: "已加载规则上下文", status: "done" };
    default:
      return null;
  }
}

function createEmptyActivity(sessionId: string, now: number): DelegateActivity {
  return {
    sessionId,
    status: "running",
    rounds: [],
    updatedAt: now,
  };
}

function ensureRound(activity: DelegateActivity, now: number): DelegateActivityRound {
  const last = activity.rounds[activity.rounds.length - 1];
  if (last && last.status === "running") return last;
  return {
    id: `round-${now}-${activity.rounds.length + 1}`,
    index: activity.rounds.length + 1,
    status: "running",
    startedAt: now,
    tools: [],
  };
}

function replaceLastRound(
  activity: DelegateActivity,
  round: DelegateActivityRound,
): DelegateActivityRound[] {
  const existingIndex = activity.rounds.findIndex((item) => item.id === round.id);
  const rounds =
    existingIndex >= 0
      ? activity.rounds.map((item) => (item.id === round.id ? round : item))
      : [...activity.rounds, round];
  return rounds.slice(-MAX_ROUNDS);
}

function upsertTool(
  tools: DelegateActivityTool[],
  toolCallId: string,
  toolName: string,
  status: DelegateActivityStatus,
): DelegateActivityTool[] {
  const idx = tools.findIndex((tool) => tool.toolCallId === toolCallId);
  if (idx < 0) {
    return [...tools, { toolCallId, toolName, status }];
  }
  return tools.map((tool) =>
    tool.toolCallId === toolCallId
      ? { ...tool, toolName: tool.toolName || toolName, status }
      : tool,
  );
}

export const useDelegateActivityStore = create<DelegateActivityState>((set) => ({
  bySession: {},

  handleEvent: (sessionId, rawEvent) => {
    const type = eventType(rawEvent);
    if (!type || !rawEvent || typeof rawEvent !== "object") return;
    const event = rawEvent as Record<string, unknown>;
    const now = Date.now();

    set((state) => {
      const current = state.bySession[sessionId] ?? createEmptyActivity(sessionId, now);
      let next: DelegateActivity = { ...current, updatedAt: now };

      if (type === "agent_start") {
        next = { ...next, status: "running" };
      } else if (type === "agent_end") {
        const rounds = next.rounds.map((round, idx) =>
          idx === next.rounds.length - 1 && round.status === "running"
            ? { ...round, status: "done" as const, endedAt: now }
            : round,
        );
        next = { ...next, status: current.status === "error" ? "error" : "done", rounds };
      } else if (type === "message_start") {
        const role = getMessageRole(event);
        if (role === "assistant") {
          const round = ensureRound(
            { ...next, rounds: next.rounds.map((item) => ({ ...item, status: item.status })) },
            now,
          );
          next = { ...next, status: "running", rounds: replaceLastRound(next, round) };
        } else if (role === "custom") {
          const customSummary = summarizeCustomEvent(getCustomType(event));
          if (customSummary) {
            const baseRound = ensureRound(next, now);
            const round = {
              ...baseRound,
              summary: customSummary.summary,
              status: customSummary.status,
              endedAt: customSummary.status === "running" ? undefined : now,
            };
            next = {
              ...next,
              status: customSummary.status === "error" ? "error" : "running",
              rounds: replaceLastRound(next, round),
            };
          }
        }
      } else if (type === "message_update") {
        const text = extractMessageText(event);
        if (text) {
          if (current.status !== "running") {
            const lastRound = next.rounds[next.rounds.length - 1];
            const rounds = lastRound
              ? replaceLastRound(next, {
                  ...lastRound,
                  summary: text,
                  status: lastRound.status === "error" ? "error" : "done",
                  endedAt: lastRound.endedAt ?? now,
                })
              : next.rounds;
            next = { ...next, status: current.status, rounds };
            return { bySession: { ...state.bySession, [sessionId]: next } };
          }
          const round = { ...ensureRound(next, now), summary: text, status: "running" as const };
          next = { ...next, status: "running", rounds: replaceLastRound(next, round) };
        }
      } else if (type === "message_end") {
        const text = extractMessageText(event);
        const round = {
          ...ensureRound(next, now),
          summary: text || ensureRound(next, now).summary,
          status: "done" as const,
          endedAt: now,
        };
        next = { ...next, rounds: replaceLastRound(next, round) };
      } else if (
        type === "tool_execution_start" ||
        type === "tool_execution_update" ||
        type === "tool_execution_end"
      ) {
        const toolCallId = getString(event, "toolCallId");
        const toolName = getString(event, "toolName") ?? "tool";
        if (!toolCallId) return state;
        const status =
          type === "tool_execution_end" ? (event.isError === true ? "error" : "done") : "running";
        const round = ensureRound(next, now);
        const tools = upsertTool(round.tools, toolCallId, toolName, status);
        const nextRoundStatus: DelegateActivityStatus = tools.some(
          (tool) => tool.status === "error",
        )
          ? "error"
          : tools.some((tool) => tool.status === "running")
            ? "running"
            : round.status === "done"
              ? "done"
              : "running";
        const updatedRound = { ...round, tools, status: nextRoundStatus };
        next = {
          ...next,
          status: nextRoundStatus === "error" ? "error" : "running",
          rounds: replaceLastRound(next, updatedRound),
        };
      }

      return { bySession: { ...state.bySession, [sessionId]: next } };
    });
  },

  clearSession: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...rest } = state.bySession;
      return { bySession: rest };
    }),
}));
