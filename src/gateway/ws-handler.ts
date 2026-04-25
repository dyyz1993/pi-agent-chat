import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { RPCServer, type Transport } from "@dyyz1993/rpc-core";
import { registerAllHandlers } from "../shared/register-all-handlers";
import { createLogger } from "../shared/lib/logger";

const log = createLogger("gateway");

export interface WsHandlerDeps {
  config: { readonly port: number; readonly authToken: string; readonly maxUploadSize: number };
}

export function createWsHandler(httpServer: Server, deps: WsHandlerDeps): WebSocketServer {
  const { config: cfg } = deps;
  const clients = new Set<WebSocket>();
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get("token");
    if (token !== cfg.authToken) {
      log.warn("Connection rejected: invalid token");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, _req) => {
    log.info("Client connected", { total: clients.size + 1 });
    clients.add(ws);

    const wsTransport = {
      send: async (message: unknown): Promise<void> => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      },
      onMessage: (handler: (message: unknown) => void): (() => void) => {
        const listener = (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            handler(msg);
          } catch (err) {
            log.error("Failed to parse message", { error: err instanceof Error ? err.message : String(err) });
          }
        };
        ws.on("message", listener);
        return () => ws.off("message", listener);
      },
      onError: (): (() => void) => {
        return () => {};
      },
      onDisconnect: (): (() => void) => {
        return () => {};
      },
      isConnected: (): boolean => ws.readyState === WebSocket.OPEN,
      close: (): void => {},
    };

    const rpcServer = new RPCServer(wsTransport as Transport);
    registerAllHandlers(rpcServer, { platform: "web" });

    ws.on("close", () => {
      clients.delete(ws);
      log.info("Client disconnected", { total: clients.size });
      rpcServer.close();
    });

    ws.on("error", (err: Error) => {
      log.error("Client error", { error: err.message });
    });
  });

  Object.defineProperty(wss, "clients", {
    get: () => clients,
  });

  return wss;
}
