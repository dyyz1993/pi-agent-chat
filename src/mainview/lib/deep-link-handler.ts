import { createLogger } from "../../shared/lib/logger";
import { platformBridge } from "./platform/bridge";
import type { DeepLinkData } from "./platform/providers/types";

const log = createLogger("deep-link");

export function parseDeepLink(url: string): DeepLinkData | null {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === "piagentchat:") {
      const parts = parsed.pathname.split("/").filter(Boolean);

      if (parts.length === 0) {
        return { action: "home" };
      }

      if (parts[0] === "server" && parts[1]) {
        const serverHost = decodeURIComponent(parts[1]);
        const token = parsed.searchParams.get("token");
        const [host, portStr] = serverHost.split(":");
        const port = parseInt(portStr ?? "3100", 10);

        if (!host || !port || isNaN(port)) {
          console.warn("[deep-link-handler] Invalid server config:", serverHost);
          return null;
        }

        return {
          action: "open_project",
          serverConfig: { host, port, token: token ?? undefined },
        };
      }

      if (parts[0] === "project" && parts[1]) {
        const projectId = decodeURIComponent(parts[1]);

        if (parts[2] === "session" && parts[3]) {
          return {
            action: "open_session",
            projectId,
            sessionId: decodeURIComponent(parts[3]),
          };
        }

        return { action: "open_project", projectId };
      }
    }

    if (parsed.protocol === "https:" && parsed.host === "app.piagent.chat") {
      const parts = parsed.pathname.split("/").filter(Boolean);

      if (parts[0] === "project" && parts[1]) {
        const projectId = decodeURIComponent(parts[1]);

        if (parts[2] === "session" && parts[3]) {
          return {
            action: "open_session",
            projectId,
            sessionId: decodeURIComponent(parts[3]),
          };
        }

        return { action: "open_project", projectId };
      }
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const projectId = parsed.searchParams.get("project");
      const sessionId = parsed.searchParams.get("session");

      if (projectId) {
        return {
          action: sessionId ? "open_session" : "open_project",
          projectId,
          sessionId: sessionId ?? undefined,
        };
      }
    }
  } catch (e) {
    console.warn("[deep-link-handler] 解析深链失败:", url, e);
  }

  return null;
}

export interface DeepLinkContext {
  isConnected: () => boolean;
  waitForConnection: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  addProjectTab: (projectId: string) => void;
  restoreSession: (sessionId: string) => Promise<void>;
  listRecentSessions: (projectId: string) => Promise<{ id: string }[]>;
  createNewSession: (projectId: string) => Promise<string>;
  scrollToMessage: (messageId: string) => void;
  getCurrentProjectId: () => string | undefined;
  getCurrentSessionId: () => string | undefined;
}

export async function executeDeepLinkRecovery(
  data: DeepLinkData,
  ctx: DeepLinkContext,
): Promise<void> {
  log.info("执行深链恢复:", { data });

  if (!ctx.isConnected()) {
    log.info("等待 WebSocket 连接");
    await ctx.waitForConnection();
  }

  switch (data.action) {
    case "home":
      log.debug("打开首页");
      break;

    case "open_project": {
      if (data.serverConfig) {
        const { host, port, token } = data.serverConfig;
        const wsUrl = `ws://${host}:${port}/ws`;
        const httpUrl = `http://${host}:${port}`;

        localStorage.setItem("rpc-websocket-url", wsUrl);
        localStorage.setItem("rpc-server-http-url", httpUrl);

        if (token) {
          localStorage.setItem("rpc-auth-token", token);
        }

        if (ctx.isConnected()) {
          log.info("Reconnecting to new server");
        } else {
          log.info("Waiting for connection to new server");
        }

        break;
      }

      const { projectId } = data;
      if (!projectId) break;
      log.info("打开项目:", { projectId });

      await ctx.openProject(projectId);
      ctx.addProjectTab(projectId);

      if (!data.sessionId) {
        try {
          const recent = await ctx.listRecentSessions(projectId);
          if (recent.length > 0) {
            await ctx.restoreSession(recent[0].id);
          } else {
            const newId = await ctx.createNewSession(projectId);
            await ctx.restoreSession(newId);
          }
        } catch (e) {
          console.warn("[deep-link-handler] 恢复会话失败:", e);
        }
      }
      break;
    }

    case "open_session": {
      const { projectId, sessionId } = data;
      if (!projectId || !sessionId) break;
      log.info("打开会话:", { projectId, sessionId });

      await ctx.openProject(projectId);
      ctx.addProjectTab(projectId);
      await ctx.restoreSession(sessionId);

      if (data.messageId) {
        setTimeout(() => {
          if (data.messageId) ctx.scrollToMessage(data.messageId);
        }, 1000);
      }
      break;
    }
  }
}

export function setupDeepLinkListener(onDeepLink: (url: string) => void): () => void {
  const unsubscribe = platformBridge.deeplink.onDeepLink(onDeepLink);

  platformBridge.deeplink.getInitialUrl().then((url) => {
    if (url) {
      log.info("冷启动深链:", { url });
      onDeepLink(url);
    }
  });

  if (typeof window !== "undefined") {
    const url = window.location.href;
    const parsed = parseDeepLink(url);
    if (parsed) {
      onDeepLink(url);
    }
  }

  return unsubscribe;
}
