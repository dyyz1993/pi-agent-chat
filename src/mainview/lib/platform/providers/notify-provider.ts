interface INotifyProvider {
  requestPermission(): Promise<boolean>;
  getPermissionStatus(): Promise<"granted" | "denied" | "prompt">;
  sendLocalNotification(options: {
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<void>;
}

function isNative(): boolean {
  return false;
}

type NotifyData = Record<string, unknown>;

class WebNotifyProvider implements INotifyProvider {
  async requestPermission(): Promise<boolean> {
    if (typeof Notification === "undefined") return false;
    const result = await Notification.requestPermission();
    return result === "granted";
  }

  async getPermissionStatus(): Promise<"granted" | "denied" | "prompt"> {
    if (typeof Notification === "undefined") return "denied";
    const p = Notification.permission as string;
    if (p === "granted" || p === "denied" || p === "prompt") return p;
    return "denied";
  }

  async sendLocalNotification(options: {
    title: string;
    body: string;
    data?: NotifyData;
  }): Promise<void> {
    if (typeof Notification === "undefined") {
      return;
    }

    const permission = await this.getPermissionStatus();
    if (permission !== "granted") return;

    const n = new Notification(options.title, {
      body: options.body,
      data: options.data,
    });

    n.onclick = () => {
      window.focus();
      n.close();
      if (options.data) {
        window.dispatchEvent(
          new CustomEvent("platform:notification-click", { detail: options.data }),
        );
      }
    };
  }
}

class NativeNotifyProvider extends WebNotifyProvider {}

export function createNotifyProvider(): INotifyProvider {
  return isNative() ? new NativeNotifyProvider() : new WebNotifyProvider();
}
