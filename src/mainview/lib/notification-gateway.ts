export type GatewayEventType =
  | "session_complete"
  | "session_error"
  | "retry_start"
  | "retry_success"
  | "retry_failed"
  | "agent_notify"
  | "permission_request"
  | "extension_llm_error";

export interface GatewayEvent {
  type: GatewayEventType;
  sessionId?: string;
  title: string;
  body: string;
  level: "info" | "warning" | "error";
  data?: Record<string, unknown>;
}

export interface NotificationChannel {
  name: string;
  send(event: GatewayEvent): void;
}

type VisibilityHandler = (visible: boolean) => void;

class NotificationGatewayImpl {
  private channels: NotificationChannel[] = [];
  private isVisible = true;
  private visibilityListeners: VisibilityHandler[] = [];

  constructor() {
    if (typeof document === "undefined") return;
    this.isVisible = !document.hidden;

    document.addEventListener("visibilitychange", () => {
      this.isVisible = !document.hidden;
      this.visibilityListeners.forEach((fn) => fn(this.isVisible));
    });
  }

  registerChannel(channel: NotificationChannel) {
    this.channels.push(channel);
  }

  removeChannel(name: string) {
    this.channels = this.channels.filter((c) => c.name !== name);
  }

  emit(event: GatewayEvent) {
    for (const channel of this.channels) {
      channel.send(event);
    }
  }

  get appVisible() {
    return this.isVisible;
  }

  onVisibilityChange(fn: VisibilityHandler) {
    this.visibilityListeners.push(fn);
    return () => {
      this.visibilityListeners = this.visibilityListeners.filter((l) => l !== fn);
    };
  }
}

export const notificationGateway = new NotificationGatewayImpl();
