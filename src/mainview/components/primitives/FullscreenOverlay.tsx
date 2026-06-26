import { memo, useId, useRef, type CSSProperties, type Ref, type ReactNode } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { cx } from "../../lib/classes";
import { IconButton } from "./IconButton";

interface FullscreenOverlayProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  closeButtonSize?: "compact" | "touch";
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  position?: "fixed" | "absolute";
  layer?: "modal" | "fullscreen";
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
  bodyStyle?: CSSProperties;
}

const positionClasses: Record<NonNullable<FullscreenOverlayProps["position"]>, string> = {
  fixed: "fixed",
  absolute: "absolute",
};

const layerClasses: Record<NonNullable<FullscreenOverlayProps["layer"]>, string> = {
  modal: "z-modal",
  fullscreen: "z-fullscreen",
};

export const FullscreenOverlay = memo(function FullscreenOverlay({
  title,
  children,
  onClose,
  closeLabel,
  closeButtonSize = "compact",
  icon,
  actions,
  footer,
  position = "fixed",
  layer = "fullscreen",
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  bodyRef,
  bodyStyle,
}: FullscreenOverlayProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, { onEscape: onClose });

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className={cx(
        "inset-0 flex flex-col overflow-hidden bg-bg-elevated",
        "dark:bg-surface-code",
        positionClasses[position],
        layerClasses[layer],
        className,
      )}
    >
      <div
        className={cx(
          "flex shrink-0 items-center gap-2 border-b border-border-secondary bg-surface-dim px-4 py-2",
          "dark:bg-surface-code",
          headerClassName,
        )}
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        {icon}
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
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

      <div
        ref={bodyRef}
        className={cx("min-h-0 flex-1 overflow-y-auto overscroll-contain", bodyClassName)}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", ...bodyStyle }}
      >
        {children}
      </div>

      {footer && (
        <div
          className={cx(
            "flex shrink-0 items-center justify-end gap-3 border-t border-border-secondary px-4 py-3",
            footerClassName,
          )}
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {footer}
        </div>
      )}
    </div>
  );
});
