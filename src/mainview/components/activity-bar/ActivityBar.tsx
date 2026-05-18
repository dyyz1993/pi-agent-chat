import { Folder, GitBranch, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebarStore, type SidebarPanelId } from "../../stores/use-sidebar-store";

const items: { id: SidebarPanelId; icon: typeof Folder; labelKey: string }[] = [
  { id: "explorer", icon: Folder, labelKey: "activityExplorer" },
  { id: "git", icon: GitBranch, labelKey: "activitySourceControl" },
  { id: "search", icon: Search, labelKey: "activitySearch" },
];

export function ActivityBar() {
  const { t } = useTranslation("sidebar");
  const activePanel = useSidebarStore((s) => s.activePanel);
  const togglePanel = useSidebarStore((s) => s.togglePanel);

  return (
    <div className="w-12 bg-surface-code border-r border-border-secondary flex flex-col items-center py-2 gap-1 flex-shrink-0">
      {items.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          data-testid={`activity-${id}`}
          title={t(labelKey)}
          aria-label={t(labelKey)}
          onClick={() => togglePanel(id)}
          className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
            activePanel === id
              ? "bg-surface-hover text-text-primary border-l-2 border-border-focus"
              : "text-text-tertiary hover:text-text-primary"
          }`}
        >
          <Icon className="w-5 h-5" />
        </button>
      ))}
    </div>
  );
}

export { items };
