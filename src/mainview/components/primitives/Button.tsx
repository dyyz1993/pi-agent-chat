import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../../lib/classes";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-semantic-accent text-white hover:bg-semantic-accent/85 active:bg-semantic-accent/90 shadow-sm shadow-semantic-accent/10",
  secondary:
    "border border-border-secondary bg-bg-elevated text-text-secondary hover:bg-surface-hover hover:text-text-primary dark:bg-surface-dim/30 dark:hover:bg-surface-hover",
  ghost: "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
  danger:
    "bg-status-error text-white hover:bg-status-error/85 active:bg-status-error shadow-sm shadow-status-error/10",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 py-1.5 text-xs",
  md: "min-h-11 px-4 py-2 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "sm",
    loading = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        sizeClasses[size],
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {loading ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
      ) : (
        leadingIcon
      )}
      {children}
      {trailingIcon}
    </button>
  );
});
