/**
 * Capacitor 插件类型声明（仅类型，不引入运行时依赖）
 *
 * Web 版本不安装 Capacitor，这些声明让 TypeScript 不报错。
 * 实际运行时通过 dynamic import() 加载，加载失败会 catch 降级。
 */
declare module "@capacitor/camera" {
  export const Camera: {
    getPhoto(options: {
      quality?: number;
      resultType: string;
      source: string;
    }): Promise<{ dataUrl?: string; path?: string }>;
  };
  export const CameraResultType: { DataUrl: string; Uri: string; Base64: string };
  export const CameraSource: { Prompt: string; Camera: string; Photos: string };
}

declare module "@capacitor/push-notifications" {
  interface PushNotificationActionPerformed {
    notification: { data?: Record<string, unknown> };
  }
  interface PushNotificationToken {
    value: string;
  }
  type PermissionStatus = "granted" | "denied" | "prompt";
  interface PushNotificationsPermissionResult {
    receive: PermissionStatus;
  }
  interface PushNotificationsCheckResult {
    receive: PermissionStatus;
  }
  interface PluginListenerHandle {
    remove(): Promise<void>;
  }
  export const PushNotifications: {
    requestPermissions(): Promise<PushNotificationsPermissionResult>;
    checkPermissions(): Promise<PushNotificationsCheckResult>;
    register(): Promise<void>;
    addListener(
      eventName: string,
      listener: (event: unknown) => void,
    ): Promise<PluginListenerHandle>;
  };
}

declare module "@capacitor/local-notifications" {
  export const LocalNotifications: {
    schedule(options: {
      notifications: Array<{
        title: string;
        body: string;
        id: number;
        extra?: Record<string, unknown>;
      }>;
    }): Promise<void>;
  };
}

declare module "@capacitor/preferences" {
  export const Preferences: {
    get(options: { key: string }): Promise<{ value: string | null }>;
    set(options: { key: string; value: string }): Promise<void>;
    remove(options: { key: string }): Promise<void>;
    clear(): Promise<void>;
  };
}

declare module "@capacitor/browser" {
  export const Browser: {
    open(options: { url: string }): Promise<void>;
  };
}

declare module "@capacitor/app" {
  interface PluginListenerHandle {
    remove(): Promise<void>;
  }
  export const App: {
    getLaunchUrl(): Promise<{ url: string } | null>;
    addListener(
      eventName: string,
      listener: (event: unknown) => void,
    ): Promise<PluginListenerHandle>;
  };
}

declare module "@capacitor/haptics" {
  export const HapticsNotificationType: {
    Light: string;
    Warning: string;
    Error: string;
  };
  export const Haptics: {
    notification(options: { type: string }): void;
    selectionStart(): void;
    selectionChanged(): void;
    selectionEnd(): void;
  };
}
