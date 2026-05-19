import { memo, type ReactNode } from "react";
import { getToolIcon } from "../tool-icon-map";

export type ToolCardStatus = "running" | "done" | "error" | "background" | "terminated";

interface ToolCardHeaderProps {
  /** Tool name for icon lookup (via getToolIcon) */
  toolName: string;
  /** Block status for color theming */
  status: ToolCardStatus;
  /** Main description text (single-line truncated) */
  description: ReactNode;
  /** Whether the card is collapsed (shows running pulse if running) */
  collapsed?: boolean;
  /** Elapsed time string (e.g. "3s", "1m20s") */
  time?: ReactNode;
  /** Right-side badge / summary */
  badge?: ReactNode;
  /** Click handler for toggle */
  onClick?: () => void;
  /** Whether description should use monospace font (file paths) */
  mono?: boolean;
  /** RTL truncation for file paths */
  rtl?: boolean;
  /** Extra class on the root header div */
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
  time,
  badge,
  onClick,
  mono,
  rtl: useRtl,
  className = "",
}: ToolCardHeaderProps) {
  const isRunning = status === "running";
  const { icon: Icon, color: baseColor } = getToolIcon(toolName);
  const iconColor = getStatusIconColor(status, `${baseColor}/70`);

  return (
    <div
      className={`px-3 py-1.5 flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-hover transition-colors select-none ${className}`}
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

      {time}

      {isRunning && !time && !badge && (
        <span className="shrink-0 text-[10px] text-status-info animate-pulse">...</span>
      )}

      {badge}
    </div>
  );
});
