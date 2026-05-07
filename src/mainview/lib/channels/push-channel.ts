import {
  notificationGateway,
  type NotificationChannel,
  type GatewayEvent,
} from "../notification-gateway";
import { platformBridge } from "../platform/bridge";

const IMPORTANT_EVENTS = new Set([
  "session_complete",
  "session_error",
  "retry_failed",
  "permission_request",
  "agent_notify",
]);

function shouldSendPush(event: GatewayEvent): boolean {
  if (!notificationGateway.appVisible) return true;
  return IMPORTANT_EVENTS.has(event.type);
}

function buildTitle(event: GatewayEvent): string {
  switch (event.type) {
    case "session_complete":
      return "✅ 任务完成";
    case "session_error":
      return "❌ 任务出错";
    case "retry_failed":
      return "⚠️ 重试失败";
    case "permission_request":
      return "🔐 权限请求";
    case "agent_notify":
      return (event.data?.title as string) || "Agent 通知";
    default:
      return "Pi Agent Chat";
  }
}

function buildBody(event: GatewayEvent): string {
  switch (event.type) {
    case "session_complete":
      return (event.data?.summary as string) || "Agent 已完成任务";
    case "session_error":
      return (event.data?.error as string) || "Agent 执行出错";
    case "permission_request":
      return (event.data?.message as string) || "Agent 请求权限";
    case "agent_notify":
      return (event.data?.body as string) || "";
    default:
      return "";
  }
}

export const pushChannel: NotificationChannel = {
  name: "push",

  send(event: GatewayEvent): void {
    if (!shouldSendPush(event)) return;

    const title = buildTitle(event);
    const body = buildBody(event);

    platformBridge.notify
      .sendLocalNotification({
        title,
        body,
        data: {
          type: event.type,
          sessionId: event.data?.sessionId,
          projectId: event.data?.projectId,
          action: "open_session",
        },
      })
      .catch((err: Error) => {
        console.warn("[push-channel] 发送推送通知失败:", err.message);
      });
  },
};
