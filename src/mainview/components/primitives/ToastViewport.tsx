import { memo } from "react";
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "../../lib/classes";
import { IconButton } from "./IconButton";

type ToastLevel = "info" | "warning" | "error";

export interface ToastViewportItem {
  id: string;
  message: string;
  level: ToastLevel;
}

interface ToastViewportProps {
  items: ToastViewportItem[];
  onDismiss: (id: string) => void;
  className?: string;
  limit?: number;
}

const levelMeta: Record<
  ToastLevel,
  {
    icon: typeof Info;
    item: string;
    iconClass: string;
    role: "status" | "alert";
  }
> = {
  info: {
    icon: Info,
    item: "bg-status-info/10 border-status-info/20",
    iconClass: "text-status-info",
    role: "status",
  },
  warning: {
    icon: AlertTriangle,
    item: "bg-status-warning/10 border-status-warning/20",
    iconClass: "text-status-warning",
    role: "status",
  },
  error: {
    icon: AlertCircle,
    item: "bg-status-error/10 border-status-error/20",
    iconClass: "text-status-error",
    role: "alert",
  },
};

export const ToastViewport = memo(function ToastViewport({
  items,
  onDismiss,
  className,
  limit = 3,
}: ToastViewportProps) {
  const { t } = useTranslation("common");
  const visibleItems = items.slice(0, limit);

  if (visibleItems.length === 0) return null;

  return (
    <div
      className={cx("z-toast flex flex-col gap-2 pointer-events-none", className)}
      aria-live="polite"
    >
      {visibleItems.map((item) => {
        const meta = levelMeta[item.level];
        const Icon = meta.icon;
        return (
          <div
            key={item.id}
            role={meta.role}
            className={cx(
              "flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm pointer-events-auto",
              meta.item,
            )}
          >
            <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", meta.iconClass)} />
            <span className="min-w-0 flex-1 break-words text-sm text-text-secondary">
              {item.message}
            </span>
            <IconButton
              onClick={() => onDismiss(item.id)}
              label={t("dismiss")}
              variant={item.level === "error" ? "danger" : "ghost"}
              size="sm"
              className="-mr-1 -mt-1 h-8 w-8 rounded-md"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
});
