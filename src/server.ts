/**
 * Web server entry point — HTTP file endpoints + WebSocket RPC gateway.
 */

import { createServer } from "http";
import { config } from "./server-config";
import { createHttpHandler } from "./gateway/http-routes";
import { createWsHandler } from "./gateway/ws-handler";

const httpServer = createServer();
const wss = createWsHandler(httpServer, { config });

httpServer.on("request", createHttpHandler({
  config,
  getWebSocketClientCount: () => wss.clients.size,
}));

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[Server] HTTP + WebSocket server running on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`[Server] WebSocket: ws://localhost:${config.port}?token=${config.authToken}`);
  // eslint-disable-next-line no-console
  console.log("[Server] Available RPC methods: system.ping, system.hello, system.echo, file.listDir, timer.start, timer.stop");
  // eslint-disable-next-line no-console
  console.log("[Server] File endpoints: GET /file/{path}, GET /info/{path}");
});
