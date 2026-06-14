import type { ComponentType } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface SectionHeaderProps {
  collapsed: boolean;
  onToggle: () => void;
  icon: ComponentType<{ className?: string }>;
  iconCls?: string;
  label: string;
  badge?: number;
}

export function SectionHeader({
  collapsed,
  onToggle,
  icon: Icon,
  iconCls,
  label,
  badge,
}: SectionHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover/50 dark:hover:bg-surface-dim/30 transition-colors"
    >
      {collapsed ? (
        <ChevronRight className="w-3 h-3 shrink-0" />
      ) : (
        <ChevronDown className="w-3 h-3 shrink-0" />
      )}
      <Icon className={`w-3 h-3 shrink-0 ${iconCls ?? ""}`} />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto text-[9px] text-text-secondary">{badge}</span>
      )}
    </button>
  );
}
