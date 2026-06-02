import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../../lib/classes";

type IconButtonVariant = "ghost" | "primary" | "danger";
type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
}

const variantClasses: Record<IconButtonVariant, string> = {
  ghost: "text-text-tertiary hover:bg-surface-hover hover:text-text-primary",
  primary: "bg-semantic-accent text-white hover:bg-semantic-accent/85",
  danger: "text-status-error hover:bg-status-error/10 hover:text-status-error",
};

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-11 w-11",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "sm", className, children, type = "button", title, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={props["aria-label"] ?? label}
      title={title ?? label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
