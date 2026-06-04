import { memo, type ReactNode } from "react";
import { getToolIcon } from "../tool-icon-map";
import { useToolDuration } from "./useToolDuration";

export type ToolCardStatus = "running" | "done" | "error" | "background" | "terminated";

interface ToolCardHeaderProps {
  toolName: string;
  status: ToolCardStatus;
  description: ReactNode;
  collapsed?: boolean;
  time?: ReactNode;
  startedAt?: number;
  endedAt?: number;
  badge?: ReactNode;
  onClick?: () => void;
  mono?: boolean;
  rtl?: boolean;
  className?: string;
}

function getStatusIconColor(status: ToolCardStatus, baseColor: string): string {
  switch (status) {
    case "running":
      return "text-status-info";
    case "error":
    case "terminated":
      return "text-status-error";
    case "background":
      return "text-status-warning";
    case "done":
      return baseColor;
    default:
      return baseColor;
  }
}

export const ToolCardHeader = memo(function ToolCardHeader({
  toolName,
  status,
  description,
  collapsed,
  time: timeProp,
  startedAt,
  endedAt,
  badge,
  onClick,
  mono,
  rtl: useRtl,
  className = "",
}: ToolCardHeaderProps) {
  const isRunning = status === "running";
  const { icon: Icon, color: baseColor } = getToolIcon(toolName);
  const iconColor = getStatusIconColor(status, `${baseColor}/70`);

  const autoDuration = useToolDuration(startedAt, endedAt, status);
  const displayTime = timeProp ?? (autoDuration ? <TimeLabel text={autoDuration} /> : undefined);

  return (
    <div
      className={`px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-hover transition-colors select-none overflow-hidden ${className}`}
      onClick={onClick}
      role="button"
      aria-expanded={onClick ? !collapsed : undefined}
    >
      {collapsed && isRunning && (
        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
      )}

      <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />

      <span
        className={`flex-1 min-w-0 truncate ${mono ? "font-mono" : "text-text-secondary"}`}
        title={typeof description === "string" ? description : undefined}
      >
        {useRtl ? (
          <span className="block rtl" style={{ direction: "rtl", textAlign: "left" }}>
            <span style={{ direction: "ltr", display: "inline" }}>{description}</span>
          </span>
        ) : (
          description
        )}
      </span>

      <span className="shrink-0 flex items-center gap-1.5 overflow-hidden">{badge}</span>

      {displayTime}

      {isRunning && !displayTime && !badge && (
        <span className="shrink-0 text-[10px] text-status-info animate-pulse">...</span>
      )}
    </div>
  );
});

function TimeLabel({ text }: { text: string }) {
  return <span className="shrink-0 text-[10px] text-text-tertiary/50 tabular-nums">{text}</span>;
}
