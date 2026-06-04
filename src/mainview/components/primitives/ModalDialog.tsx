import { memo, useId, useRef, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { cx } from "../../lib/classes";
import { IconButton } from "./IconButton";

type ModalDialogSize = "sm" | "md" | "lg";

interface ModalDialogProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  icon?: ReactNode;
  footer?: ReactNode;
  size?: ModalDialogSize;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

const sizeClasses: Record<ModalDialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-xl",
  lg: "max-w-3xl",
};

export const ModalDialog = memo(function ModalDialog({
  title,
  children,
  onClose,
  closeLabel,
  icon,
  footer,
  size = "md",
  showCloseButton = true,
  closeOnBackdrop = true,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  style,
  "data-testid": dataTestId,
}: ModalDialogProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useFocusTrap(containerRef, { onEscape: onClose });

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-bg-overlay backdrop-blur-sm px-4 sm:px-6"
      style={{
        paddingTop: "calc(1rem + env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={dataTestId}
        className={cx(
          "relative flex max-h-[min(80vh,680px)] w-full flex-col overflow-hidden rounded-xl border border-border-secondary bg-bg-elevated shadow-2xl",
          "dark:bg-surface-code dark:border-border-secondary/70",
          sizeClasses[size],
          className,
        )}
        style={style}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={cx(
            "flex shrink-0 items-center gap-2 border-b border-border-secondary px-4 py-2.5",
            "dark:border-border-secondary/70",
            headerClassName,
          )}
        >
          {icon}
          <h2
            id={titleId}
            className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary"
          >
            {title}
          </h2>
          {showCloseButton && (
            <IconButton label={closeLabel} size="md" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>

        <div className={cx("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>

        {footer && (
          <div
            className={cx(
              "flex shrink-0 items-center gap-3 border-t border-border-secondary px-4 py-3",
              "dark:border-border-secondary/70",
              !footerClassName && "justify-end",
              footerClassName,
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
});
