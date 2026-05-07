import { isNative } from '../index';
import type { INotifyProvider } from './types';

/**
 * Web 降级实现 — 使用浏览器 Notification API
 */
class WebNotifyProvider implements INotifyProvider {
  async requestPermission(): Promise<boolean> {
    if (typeof Notification === 'undefined') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  async getPermissionStatus(): Promise<'granted' | 'denied' | 'prompt'> {
    if (typeof Notification === 'undefined') return 'denied';
    const p = Notification.permission as string;
    if (p === 'granted' || p === 'denied' || p === 'prompt') return p;
    return 'denied';
  }

  async sendLocalNotification(options: {
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void> {
    const permission = await this.getPermissionStatus();
    if (permission !== 'granted') return;

    const n = new Notification(options.title, {
      body: options.body,
      data: options.data,
    });

    n.onclick = () => {
      window.focus();
      n.close();
      if (options.data) {
        window.dispatchEvent(
          new CustomEvent('platform:notification-click', { detail: options.data }),
        );
      }
    };
  }
}

/**
 * 原生增强实现 — 使用 Capacitor LocalNotifications + PushNotifications
 */
class NativeNotifyProvider extends WebNotifyProvider {
  override async requestPermission(): Promise<boolean> {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const result = await PushNotifications.requestPermissions();
      return result.receive === 'granted';
    } catch {
      return super.requestPermission();
    }
  }

  override async getPermissionStatus(): Promise<'granted' | 'denied' | 'prompt'> {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const result = await PushNotifications.checkPermissions();
      return result.receive;
    } catch {
      return super.getPermissionStatus();
    }
  }

  override async sendLocalNotification(options: {
    title: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<void> {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [
          {
            title: options.title,
            body: options.body,
            id: Date.now(),
            extra: options.data,
          },
        ],
      });
    } catch {
      await super.sendLocalNotification(options);
    }
  }

  async registerPushToken(): Promise<string | null> {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.register();
      return new Promise((resolve) => {
        PushNotifications.addListener('registration', (token: { value: string }) => {
          resolve(token.value);
        });
        PushNotifications.addListener('registrationError', () => {
          resolve(null);
        });
      });
    } catch {
      return null;
    }
  }

  onNotificationClick(callback: (data: Record<string, any>) => void): () => void {
    let removed = false;
    let cleanup: (() => void) | null = null;

    import('@capacitor/push-notifications')
      .then(({ PushNotifications }) => {
        if (removed) return;
        return PushNotifications.addListener(
          'pushNotificationActionPerformed',
          (event: { notification: { data?: Record<string, any> } }) => {
            callback(event.notification.data || {});
          },
        ).then((handle) => {
          if (removed) {
            handle.remove();
          } else {
            cleanup = () => handle.remove();
          }
        });
      })
      .catch(() => {
        // Capacitor 不可用，降级为 CustomEvent
        const handler = (e: Event) => callback((e as CustomEvent).detail);
        window.addEventListener('platform:notification-click', handler);
        cleanup = () => window.removeEventListener('platform:notification-click', handler);
      });

    return () => {
      removed = true;
      cleanup?.();
    };
  }
}

export function createNotifyProvider(): INotifyProvider {
  return isNative() ? new NativeNotifyProvider() : new WebNotifyProvider();
}
