import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebarStore } from "../../stores/use-sidebar-store";

export function PinButton() {
  const { t } = useTranslation("sidebar");
  const isPinned = useSidebarStore((s) => s.isPinned);
  const setPinned = useSidebarStore((s) => s.setPinned);
  const isMobile = useSidebarStore((s) => s.breakpoint) === "mobile";

  if (isMobile) return null;

  return (
    <button
      onClick={() => setPinned(!isPinned)}
      title={isPinned ? t("unpinSidebar") : t("pinSidebar")}
      aria-label={isPinned ? t("unpinSidebar") : t("pinSidebar")}
      className="text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
    >
      {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
    </button>
  );
}
