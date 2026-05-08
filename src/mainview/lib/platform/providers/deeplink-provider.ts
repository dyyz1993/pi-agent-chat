import { isNative } from "../index";
import type { IDeepLinkProvider, DeepLinkData } from "./types";

/**
 * Web 降级实现 — 使用 URL 参数 + popstate 事件
 */
class WebDeepLinkProvider implements IDeepLinkProvider {
  async getInitialUrl(): Promise<string | null> {
    if (typeof window === "undefined") return null;
    return window.location.href;
  }

  onDeepLink(callback: (url: string) => void): () => void {
    const handler = () => callback(window.location.href);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }

  navigate(url: string): void {
    if (typeof window === "undefined") return;
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  parse(url: string): DeepLinkData | null {
    try {
      const u = new URL(url);
      const action = u.pathname.replace(/^\//, "") || "home";

      const validActions = ["home", "open_project", "open_session"] as const;
      if (!validActions.includes(action as DeepLinkData["action"])) return null;

      return {
        action: action as DeepLinkData["action"],
        projectId: u.searchParams.get("projectId") ?? undefined,
        sessionId: u.searchParams.get("sessionId") ?? undefined,
        messageId: u.searchParams.get("messageId") ?? undefined,
      };
    } catch {
      return null;
    }
  }
}

/**
 * 原生增强实现 — 使用 Capacitor App 插件处理深链
 */
class NativeDeepLinkProvider extends WebDeepLinkProvider {
  override async getInitialUrl(): Promise<string | null> {
    try {
      const { App } = await import("@capacitor/app");
      const result = await App.getLaunchUrl();
      return result?.url ?? null;
    } catch {
      return super.getInitialUrl();
    }
  }

  override onDeepLink(callback: (url: string) => void): () => void {
    let removed = false;
    let cleanup: (() => void) | null = null;

    import("@capacitor/app")
      .then(({ App }) => {
        if (removed) return;
        return App.addListener("appUrlOpen", (event: unknown) => {
          const url = (event as { url: string }).url;
          callback(url);
        }).then((handle) => {
          if (removed) {
            handle.remove();
          } else {
            cleanup = () => handle.remove();
          }
        });
      })
      .catch(() => {
        // Capacitor 不可用，降级为 popstate
        const handler = () => callback(window.location.href);
        window.addEventListener("popstate", handler);
        cleanup = () => window.removeEventListener("popstate", handler);
      });

    return () => {
      removed = true;
      cleanup?.();
    };
  }

  override navigate(url: string): void {
    // 原生端通过 URL scheme 或 Intent 导航
    // 当前阶段降级为 Web pushState
    super.navigate(url);
  }
}

export function createDeepLinkProvider(): IDeepLinkProvider {
  return isNative() ? new NativeDeepLinkProvider() : new WebDeepLinkProvider();
}
