import { cloneElement, memo, useId, type ReactElement } from "react";
import { cx } from "../../lib/classes";

type TooltipSide = "top" | "bottom" | "left" | "right";

interface TooltipChildProps {
  "aria-describedby"?: string;
}

interface TooltipProps {
  label: string;
  children: ReactElement<TooltipChildProps>;
  side?: TooltipSide;
  disabled?: boolean;
  className?: string;
}

const sideClasses: Record<TooltipSide, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export const Tooltip = memo(function Tooltip({
  label,
  children,
  side = "top",
  disabled = false,
  className,
}: TooltipProps) {
  const tooltipId = useId();
  if (disabled || !label) return children;

  const describedBy = [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" ");

  return (
    <span className={cx("group/tooltip relative inline-flex", className)}>
      {cloneElement(children, { "aria-describedby": describedBy })}
      <span
        id={tooltipId}
        role="tooltip"
        className={cx(
          "pointer-events-none absolute z-tooltip max-w-64 whitespace-nowrap rounded-md border border-border-secondary bg-bg-elevated px-2 py-1 text-[11px] leading-tight text-text-secondary shadow-lg",
          "opacity-0 scale-95 transition duration-150",
          "group-hover/tooltip:opacity-100 group-hover/tooltip:scale-100 group-focus-within/tooltip:opacity-100 group-focus-within/tooltip:scale-100",
          sideClasses[side],
        )}
      >
        {label}
      </span>
    </span>
  );
});
