import { notificationGateway, type NotificationChannel, type GatewayEvent } from "../notification-gateway";
import { useNotificationStore } from "../../stores/use-notification-store";

const InAppChannel: NotificationChannel = {
  name: "in-app",

  send(event: GatewayEvent) {
    useNotificationStore.getState().push({
      message: event.type === "agent_notify" ? event.title : event.title + (event.body ? `：${event.body}` : ""),
      level: event.level,
      sessionId: event.sessionId,
    });
  },
};

notificationGateway.registerChannel(InAppChannel);
