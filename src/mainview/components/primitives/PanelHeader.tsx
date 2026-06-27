import type { ComponentType, ReactNode } from "react";

export interface PanelHeaderProps {
  icon: ComponentType<{ className?: string }>;
  iconCls?: string;
  title: ReactNode;
  /** Optional content rendered on the right side (ml-auto) */
  trailing?: ReactNode;
  className?: string;
}

export function PanelHeader({ icon: Icon, iconCls, title, trailing, className }: PanelHeaderProps) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 border-b border-border-secondary dark:border-surface-code shrink-0 ${className ?? ""}`}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 ${iconCls ?? "text-semantic-accent"}`} />
      <span className="text-[11px] font-medium text-text-secondary">{title}</span>
      {trailing && <div className="ml-auto flex items-center gap-1">{trailing}</div>}
    </div>
  );
}
