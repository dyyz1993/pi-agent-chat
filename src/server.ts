/**
 * Web server entry point — HTTP file endpoints + WebSocket RPC gateway.
 */

import { createServer } from "http";
import { config } from "./server-config";
import { createHttpHandler } from "./gateway/http-routes";
import { createWsHandler } from "./gateway/ws-handler";
import { createLogger, setLogSink } from "./shared/lib/logger";
import { configureLogDir, writeLogLine } from "./shared/lib/logger.node";

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

httpServer.on(
  "request",
  createHttpHandler({
    config,
    getWebSocketClientCount: () => wss.clients.size,
  }),
);

const HOST = process.env.HOST ?? "0.0.0.0";
httpServer.listen(config.port, HOST, () => {
  log.info(`HTTP + WebSocket server running on http://localhost:${config.port}`);
  log.info(`Server listening on ${HOST}:${config.port} (accessible via local IP)`);
  log.info(`WebSocket: ws://localhost:${config.port}/ws?token=${config.authToken}`);
  log.info(
    "Available RPC methods: system.ping, system.hello, system.echo, file.listDir, timer.start, timer.stop",
  );
  log.info("File endpoints: GET /file/{path}, GET /info/{path}");
});
