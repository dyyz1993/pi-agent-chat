/**
 * Web server entry point — HTTP file endpoints + WebSocket RPC gateway.
 */

import { createServer } from "http";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { config } from "./server-config";
import { createHttpHandler } from "./gateway/http-routes";
import { createWsHandler } from "./gateway/ws-handler";
import {
  isDrelUserAgent,
  setAgentEndPushPresenceSource,
} from "./shared/agent/agent-end-notifier";
import { getMimeType } from "./gateway/mime";
import { safeWsSend } from "./gateway/ws-broadcast";
import { type WebSocket } from "ws";
import { createLogger, setLogSink } from "./shared/lib/logger";
import { configureLogDir, writeLogLine } from "./shared/lib/logger.node";
import { initSandboxManager, getSandboxManager } from "./shared/agent/process-manager";
import { isEventVisible } from "./shared/agent/session-ownership";

configureLogDir(config.logDir);
setLogSink(writeLogLine);
const log = createLogger("server");

// ── Crash protection: catch unhandled errors at process level ──
// EPIPE on a dead stdout (e.g. the launching ssh/terminal went away) must be
// swallowed SILENTLY: logging it writes back into the same broken pipe and
// the uncaughtException handler re-enters itself — a sync livelock that
// produced a 240MB log and starved the RPC loop on a Windows deployment.
process.on("uncaughtException", (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EPIPE" || (err instanceof Error && err.message.includes("EPIPE"))) return;
  log.error("UNCAUGHT EXCEPTION — server staying alive", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
});

process.on("unhandledRejection", (reason) => {
  log.error("UNHANDLED REJECTION — server staying alive", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

log.info("=== 服务器环境变量诊断 ===");
log.info("AUTH_TOKEN:", { configured: !!process.env.AUTH_TOKEN });
log.info("PORT:", { value: process.env.PORT });
log.info("LOG_DIR:", { value: process.env.LOG_DIR });
log.info("PI_CLI_PATH:", { value: process.env.PI_CLI_PATH });
log.info("PI_APP_CONFIG_DIR:", { value: process.env.PI_APP_CONFIG_DIR });
log.info("==============================");
// Multi-token deployments run untrusted users' agents on this host. Without a
// sandbox, a session process can read anything this OS user can — including
// other users' session files. Warn loudly; operators must either enable
// SANDBOX_ENABLED=true or only share the server with fully trusted users.
if (String(process.env.TOKEN_USERS ?? "").trim() && !config.sandboxEnabled) {
  log.warn("═══════════════════════════════════════════════════════════");
  log.warn("⚠  SECURITY: TOKEN_USERS is set but SANDBOX_ENABLED is off.");
  log.warn("⚠  Token-user agents execute on this host WITHOUT isolation.");
  log.warn("⚠  Set SANDBOX_ENABLED=true before sharing with untrusted users.");
  log.warn("═══════════════════════════════════════════════════════════");
}
// ── Worktree detection ──
const gitPath = join(process.cwd(), ".git");
if (existsSync(gitPath) && statSync(gitPath).isFile()) {
  const gitContent = readFileSync(gitPath, "utf-8");
  const match = gitContent.match(/^gitdir:\s*(.+)/m);
  const mainRepo = match ? resolve(dirname(match[1].trim()), "..") : "(unknown)";
  log.info("┌─ Worktree detected ──────────────────────");
  log.info("│ worktree: " + process.cwd());
  log.info("│ main repo: " + mainRepo);
  try {
    const gitDir = match ? match[1].trim() : "";
    const headPath = gitDir ? join(gitDir, "HEAD") : "";
    if (headPath && existsSync(headPath)) {
      log.info(
        "│ branch: " +
          readFileSync(headPath, "utf-8")
            .trim()
            .replace(/^ref: refs\/heads\//, ""),
      );
    }
  } catch {}
  log.info("└───────────────────────────────────────────");
}

const httpServer = createServer();
const wss = createWsHandler(httpServer, { config });

// Presence for the agent_end Drel push, classified by UA: clients inside the
// Drel container suppress pushes (user is looking in-app); desktop browsers
// do not affect delivery.
setAgentEndPushPresenceSource(() => {
  let total = 0;
  let drel = 0;
  for (const ws of wss.clients as Set<WebSocket>) {
    const meta = ws as WebSocket & { isAlive?: boolean; ua?: string };
    if (meta.isAlive === false) continue;
    total++;
    if (isDrelUserAgent(meta.ua)) drel++;
  }
  return { total, drel };
});

const distPath = resolve(process.cwd(), "dist");

const apiHandler = createHttpHandler({
  config,
  getWebSocketClientCount: () => wss.clients.size,
  broadcastEvent: (event: Record<string, unknown>) => {
    const msg = JSON.stringify(event);
    for (const ws of wss.clients as Set<WebSocket>) {
      // Multi-token deployments: session-scoped events only reach the
      // connection that owns the session (admin/undefined uid sees all).
      const uid = (ws as WebSocket & { uid?: string }).uid;
      if (!isEventVisible(String(event.eventType ?? ""), event.payload, event.metadata, uid)) {
        continue;
      }
      safeWsSend(ws, msg);
    }
  },
  sandboxEnabled: config.sandboxEnabled,
  getSandboxPreviewEndpoint: config.sandboxEnabled
    ? async (userId: string) => {
        const mgr = getSandboxManager();
        if (!mgr) return null;
        try {
          const instance = await mgr.getOrCreate(userId);
          return instance.endpoint ?? null;
        } catch (err) {
          log.warn("Failed to get sandbox preview endpoint", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      }
    : undefined,
});

httpServer.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (
    pathname.startsWith("/health") ||
    pathname.startsWith("/info/") ||
    pathname.startsWith("/file/") ||
    pathname.startsWith("/fs/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/ws") ||
    pathname.startsWith("/__proxy__/")
  ) {
    return apiHandler(req, res);
  }

  let filePath = join(distPath, pathname);
  if (pathname === "/" || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distPath, "index.html");
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath);
    const contentType = getMimeType(ext);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(readFileSync(filePath));
    return;
  }

  return apiHandler(req, res);
});

httpServer.listen(config.port, () => {
  log.info(`HTTP + WebSocket server running on http://localhost:${config.port}`);
  log.info(`WebSocket: ws://localhost:${config.port}/ws`);
  log.info(
    "Available RPC methods: system.ping, system.hello, system.echo, file.listDir, timer.start, timer.stop",
  );
  log.info("File endpoints: GET /file/{path}, GET /info/{path}");

  // 初始化沙箱管理器（如果启用了沙箱模式）
  if (config.sandboxEnabled) {
    const projectsDir = resolve(process.cwd(), "data", "sandbox-projects");
    const sm = initSandboxManager(projectsDir);
    log.info("Sandbox manager initialized", { provider: config.sandboxProvider, projectsDir });
    // 进程退出时清理沙箱
    process.on("SIGINT", () => {
      sm.stop();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      sm.stop();
      process.exit(0);
    });
  }
});
