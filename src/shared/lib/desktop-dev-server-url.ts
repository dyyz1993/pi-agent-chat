const DEFAULT_DESKTOP_DEV_SERVER_URL = "http://localhost:5173";

export function resolveDesktopDevServerUrl(env: Record<string, string | undefined> = process.env): string {
  return env.PI_AGENT_CHAT_DEV_SERVER_URL ?? env.VITE_DEV_SERVER_URL ?? DEFAULT_DESKTOP_DEV_SERVER_URL;
}
