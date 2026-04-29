import { notificationGateway, type NotificationChannel, type GatewayEvent } from "../notification-gateway";

function shouldShowPwa(event: GatewayEvent): boolean {
  if (!notificationGateway.appVisible) return true;

  switch (event.type) {
    case "session_complete":
    case "session_error":
    case "retry_failed":
    case "permission_request":
      return true;
    default:
      return false;
  }
}

const PwaChannel: NotificationChannel = {
  name: "pwa",

  send(event: GatewayEvent) {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (!shouldShowPwa(event)) return;

    try {
      const n = new Notification(event.title, {
        body: event.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-72.png",
        tag: event.sessionId ? `${event.type}-${event.sessionId}` : event.type,
        data: { ...event.data, type: event.type, sessionId: event.sessionId },
      } as NotificationOptions);

      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {}
  },
};

notificationGateway.registerChannel(PwaChannel);

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}
