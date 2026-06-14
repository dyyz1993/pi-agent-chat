import { Archive, Bot, User } from "lucide-react";
import type { ChatMessage } from "../../types";

export interface MessageCardProps {
  message: ChatMessage;
  cardLabel?: string;
  prevBarColor?: string;
  mergedResultData?: unknown;
}

export const EMPTY_MSGS: never[] = [];

export const ROLE_CONFIG = {
  user: {
    icon: User,
    color: "text-status-info/80",
    barColor: "border-l-status-info/60",
    bgColor: "bg-status-info/[0.03]",
    altBarColor: "border-l-status-info/40",
    altBgColor: "bg-status-info/[0.02]",
  },
  assistant: {
    icon: Bot,
    color: "text-status-success/70",
    barColor: "border-l-status-success/50",
    bgColor: "bg-status-success/[0.03]",
    altBarColor: "border-l-status-success/30",
    altBgColor: "bg-status-success/[0.02]",
  },
  compactionSummary: {
    icon: Archive,
    color: "text-semantic-tool/70",
    barColor: "border-l-semantic-tool/50",
    bgColor: "bg-semantic-tool/[0.03]",
    altBarColor: "border-l-semantic-tool/30",
    altBgColor: "bg-semantic-tool/[0.02]",
  },
} as const;

export const ENTRY_DEFAULT = {
  barColor: "border-l-status-warning/50",
  labelColor: "text-status-warning/70",
  bgColor: "bg-status-warning/[0.04]",
  altBarColor: "border-l-status-warning/30",
  altBgColor: "bg-status-warning/[0.02]",
};

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function isToolUseStopReason(stopReason: string | null | undefined): boolean {
  return stopReason === "toolUse" || stopReason === "tool_use";
}

export function isRecoverableBoundaryStopReason(stopReason: string | null | undefined): boolean {
  return (
    stopReason === "stop" ||
    stopReason === "endTurn" ||
    stopReason === "end_turn" ||
    isToolUseStopReason(stopReason)
  );
}
