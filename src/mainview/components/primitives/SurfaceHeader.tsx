import { memo, useId, type ReactNode } from "react";
import { X } from "lucide-react";

import { cx } from "../../lib/classes";
import { IconButton } from "./IconButton";

export interface SurfaceHeaderProps {
  title: ReactNode;
  closeLabel: string;
  onClose: () => void;
  closeButtonSize?: "compact" | "touch";
  safeAreaTop?: boolean;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
}

export const SurfaceHeader = memo(function SurfaceHeader({
  title,
  closeLabel,
  onClose,
  closeButtonSize = "compact",
  safeAreaTop = false,
  icon,
  actions,
  className,
  titleId,
}: SurfaceHeaderProps) {
  const fallbackTitleId = useId();
  const resolvedTitleId = titleId ?? fallbackTitleId;

  return (
    <div
      className={cx(
        "flex shrink-0 items-center gap-2 border-b border-border-secondary bg-surface-dim px-4 py-2",
        "dark:bg-surface-code",
        safeAreaTop && "surface-header-safe-top",
        className,
      )}
    >
      {icon}
      <h2
        id={resolvedTitleId}
        className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary"
      >
        {title}
      </h2>
      {actions}
      <IconButton
        label={closeLabel}
        size={closeButtonSize === "touch" ? "md" : "sm"}
        onClick={onClose}
        className={cx(
          "rounded-md",
          closeButtonSize === "compact" &&
            "text-text-tertiary hover:bg-surface-hover/70 hover:text-text-primary",
        )}
      >
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  );
});
