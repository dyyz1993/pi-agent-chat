/**
 * Web server entry point — HTTP file endpoints + WebSocket RPC gateway.
 */

import { createServer } from "http";
import { existsSync, readFileSync, statSync } from "fs";
import { extname, join, resolve } from "path";
import { config } from "./server-config";
import { createHttpHandler } from "./gateway/http-routes";
import { createWsHandler } from "./gateway/ws-handler";
import { createLogger, setLogSink } from "./shared/lib/logger";
import { configureLogDir, writeLogLine } from "./shared/lib/logger.node";
import { initSandboxManager } from "./shared/agent/process-manager";

configureLogDir(config.logDir);
setLogSink(writeLogLine);
const log = createLogger("server");

log.info("=== 服务器环境变量诊断 ===");
log.info("AUTH_TOKEN:", { value: process.env.AUTH_TOKEN });
log.info("PORT:", { value: process.env.PORT });
log.info("LOG_DIR:", { value: process.env.LOG_DIR });
log.info("PI_CLI_PATH:", { value: process.env.PI_CLI_PATH });
log.info("==============================");

const httpServer = createServer();
const wss = createWsHandler(httpServer, { config });

const distPath = resolve(process.cwd(), "dist");
const STATIC_MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

const apiHandler = createHttpHandler({
  config,
  getWebSocketClientCount: () => wss.clients.size,
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
    const contentType = STATIC_MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(readFileSync(filePath));
    return;
  }

  return apiHandler(req, res);
});

httpServer.listen(config.port, () => {
  log.info(`HTTP + WebSocket server running on http://localhost:${config.port}`);
  log.info(`WebSocket: ws://localhost:${config.port}/ws?token=${config.authToken}`);
  log.info(
    "Available RPC methods: system.ping, system.hello, system.echo, file.listDir, timer.start, timer.stop",
  );
  log.info("File endpoints: GET /file/{path}, GET /info/{path}");

  // 初始化沙箱管理器（如果启用了沙箱模式）
  if (config.sandboxEnabled) {
    const projectsDir = resolve(process.cwd(), "data", "sandbox-projects");
    const sm = initSandboxManager(projectsDir);
    log.info("Sandbox manager initialized", { basePort: config.sandboxBasePort, projectsDir });
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
