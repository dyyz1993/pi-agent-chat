import type { NotificationSettings } from "../lib/project-config";

/**
 * Notification RPC methods — Drel agent-end push settings.
 *
 * Backed by src/shared/handlers/notification.ts; settings persist in
 * project-config (notificationSettings).
 */
export interface NotificationMethods {
  "notification.getSettings": {
    params: {};
    result: NotificationSettings;
  };
  "notification.setAgentEndPushEnabled": {
    params: { enabled: boolean };
    result: void;
  };
  "notification.setAgentEndPushImmersive": {
    params: { enabled: boolean };
    result: void;
  };
  "notification.setAgentEndPresenceSuppress": {
    params: { enabled: boolean };
    result: void;
  };
}
