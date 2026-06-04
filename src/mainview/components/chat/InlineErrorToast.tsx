import { useNotificationStore } from "../../stores/use-notification-store";
import { AlertTriangle, X } from "lucide-react";

export function InlineErrorToast() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  const errorNotifs = notifications.filter((n) => n.level === "error" && !n.read);
  if (errorNotifs.length === 0) return null;

  return (
    <div className="absolute top-3 left-3 right-3 z-50 flex flex-col gap-2 pointer-events-none">
      {errorNotifs.slice(0, 3).map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-2 px-3 py-2 rounded-lg bg-status-error/10 border border-status-error/20 backdrop-blur-sm pointer-events-auto"
        >
          <AlertTriangle className="w-4 h-4 text-status-error shrink-0 mt-0.5" />
          <span className="text-sm text-status-error flex-1">{n.message}</span>
          <button
            onClick={() => dismiss(n.id)}
            className="shrink-0 p-0.5 hover:bg-status-error/20 rounded"
          >
            <X className="w-3.5 h-3.5 text-status-error" />
          </button>
        </div>
      ))}
    </div>
  );
}
