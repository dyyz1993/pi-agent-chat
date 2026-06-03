import { useNotificationStore } from "../../stores/use-notification-store";
import { ToastViewport } from "../primitives";

export function InlineErrorToast() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  const unreadNotifications = notifications
    .filter((n) => !n.read)
    .map((n) => ({ id: n.id, message: n.message, level: n.level }));

  return (
    <ToastViewport
      items={unreadNotifications}
      onDismiss={dismiss}
      className="absolute top-3 left-3 right-3"
    />
  );
}
