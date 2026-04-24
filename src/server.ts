/**
 * Web server entry point — HTTP file endpoints + WebSocket RPC gateway.
 */

import { createServer } from "http";
import { config } from "./server-config";
import { createHttpHandler } from "./gateway/http-routes";
import { createWsHandler } from "./gateway/ws-handler";
import { createLogger, configureLogDir } from "./shared/lib/logger";

configureLogDir(config.logDir);
const log = createLogger("server");

const httpServer = createServer();
const wss = createWsHandler(httpServer, { config });

httpServer.on("request", createHttpHandler({
  config,
  getWebSocketClientCount: () => wss.clients.size,
}));

httpServer.listen(config.port, () => {
  log.info(`HTTP + WebSocket server running on http://localhost:${config.port}`);
  log.info(`WebSocket: ws://localhost:${config.port}?token=${config.authToken}`);
  log.info("Available RPC methods: system.ping, system.hello, system.echo, file.listDir, timer.start, timer.stop");
  log.info("File endpoints: GET /file/{path}, GET /info/{path}");
});
