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
    <div className="w-12 bg-gray-100 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-2 gap-1 flex-shrink-0">
      {items.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          data-testid={`activity-${id}`}
          title={t(labelKey)}
          aria-label={t(labelKey)}
          onClick={() => togglePanel(id)}
          className={`w-10 h-10 flex items-center justify-center rounded transition-colors ${
            activePanel === id
              ? "bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white border-l-2 border-gray-900 dark:border-white"
              : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
          }`}
        >
          <Icon className="w-5 h-5" />
        </button>
      ))}
    </div>
  );
}

export { items };
