import type { HTMLAttributes, ReactNode } from "react";

export type CardTone = "info" | "warning" | "error" | "accent" | "success";

interface CardPrimitiveProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  className?: string;
  children?: ReactNode;
}

const TONE_BORDER: Record<CardTone, string> = {
  info: "border-border-primary",
  warning: "border-status-warning/35",
  error: "border-status-error/35",
  accent: "border-accent/25",
  success: "border-status-success/35",
};

const TONE_BG: Record<CardTone, string> = {
  info: "bg-bg-secondary",
  warning: "bg-status-warning/10",
  error: "bg-status-error/10",
  accent: "bg-accent/5",
  success: "bg-status-success/10",
};

/**
 * Shared container for the cards that cluster in the composer area
 * (goal status / goal draft / remote-disconnected / permission prompts).
 * Centralises rounded-lg + border + bg + shadow so they stop drifting apart.
 */
export function CardPrimitive({ tone = "info", className, children, ...rest }: CardPrimitiveProps) {
  return (
    <div
      className={`rounded-lg border ${TONE_BORDER[tone]} ${TONE_BG[tone]} shadow-sm ${className ?? ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}
