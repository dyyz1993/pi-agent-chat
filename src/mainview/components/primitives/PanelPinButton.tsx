import { memo } from "react";
import { Pin } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PanelPinButtonProps {
  isPinned: boolean;
  onToggle: () => void;
}

/**
 * Shared pin toggle button for sidebar panels (LeftSidebar / RightSidebar).
 *
 * Note: This is distinct from the deprecated `PinButton` in `sidebar/PinButton.tsx`
 * which is coupled to `useSidebarStore` and used by the GitPanel.
 */
export const PanelPinButton = memo(function PanelPinButton({
  isPinned,
  onToggle,
}: PanelPinButtonProps) {
  const { t } = useTranslation("sidebar");
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`p-1.5 rounded-md transition-colors max-sm:hidden ${isPinned ? "text-semantic-accent bg-semantic-accent/10" : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}`}
      title={isPinned ? t("unpinPanel") : t("pinPanel")}
      aria-label={isPinned ? t("unpinPanel") : t("pinPanel")}
    >
      <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
    </button>
  );
});
