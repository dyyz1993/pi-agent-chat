import {
  memo,
  useId,
  useRef,
  type CSSProperties,
  type MouseEventHandler,
  type Ref,
  type ReactNode,
} from "react";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { cx } from "../../lib/classes";
import { SurfaceHeader } from "./SurfaceHeader";

export interface FullscreenOverlayProps {
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
  headerSafeAreaTop?: boolean;
  bodyRef?: Ref<HTMLDivElement>;
  bodyStyle?: CSSProperties;
  testId?: string;
  onRootClick?: MouseEventHandler<HTMLDivElement>;
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
  headerSafeAreaTop,
  bodyRef,
  bodyStyle,
  testId,
  onRootClick,
}: FullscreenOverlayProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldApplyHeaderSafeAreaTop = headerSafeAreaTop ?? position === "fixed";

  useFocusTrap(containerRef, { onEscape: onClose });

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid={testId}
      className={cx(
        "inset-0 flex flex-col overflow-hidden bg-bg-elevated",
        "dark:bg-surface-code",
        positionClasses[position],
        layerClasses[layer],
        className,
      )}
      onClick={onRootClick}
    >
      <SurfaceHeader
        title={title}
        titleId={titleId}
        closeLabel={closeLabel}
        closeButtonSize={closeButtonSize}
        safeAreaTop={shouldApplyHeaderSafeAreaTop}
        icon={icon}
        actions={actions}
        className={headerClassName}
        onClose={onClose}
      />

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
