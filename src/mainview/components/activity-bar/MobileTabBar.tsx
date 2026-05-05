import { useTranslation } from "react-i18next";
import { useSidebarStore } from "../../stores/use-sidebar-store";
import { items } from "./ActivityBar";

export function MobileTabBar() {
  const { t } = useTranslation("sidebar");
  const activePanel = useSidebarStore((s) => s.activePanel);
  const togglePanel = useSidebarStore((s) => s.togglePanel);

  return (
    <div className="h-14 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-around flex-shrink-0">
      {items.map(({ id, icon: Icon, labelKey }) => (
        <button
          key={id}
          onClick={() => togglePanel(id)}
          className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded transition-colors ${
            activePanel === id
              ? "text-indigo-400"
              : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
          }`}
        >
          <Icon className="w-5 h-5" />
          <span className="text-[10px]">{t(labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
