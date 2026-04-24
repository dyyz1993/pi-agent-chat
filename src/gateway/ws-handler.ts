/**
 * WebSocket handler for the web gateway.
 * Handles WS connections, auth, and bridges to RPCServer.
 */

import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { RPCServer, type Transport } from "@dyyz1993/rpc-core";
import { registerAllHandlers } from "../shared/register-all-handlers";

export interface WsHandlerDeps {
  config: { readonly port: number; readonly authToken: string; readonly maxUploadSize: number };
}

export function createWsHandler(httpServer: Server, deps: WsHandlerDeps): WebSocketServer {
  const { config: cfg } = deps;
  const wss = new WebSocketServer({ server: httpServer, path: "/" });

  wss.on("connection", (ws: WebSocket, req) => {
    // Token 验证
    const url = req.url ? new URL(req.url, "http://localhost") : null;
    const token = url?.searchParams.get("token");
    if (token !== cfg.authToken) {
      // eslint-disable-next-line no-console
      console.log("[WS] Connection rejected: invalid token");
      ws.close(4001, "Unauthorized");
      return;
    }

    // eslint-disable-next-line no-console
    console.log("[WS] Client connected, total:", wss.clients.size);

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
            console.error("[WS] Failed to parse message:", err instanceof Error ? err.message : String(err));
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

    // 自动导入并注册所有 handlers
    registerAllHandlers(rpcServer, { platform: "web" });

    ws.on("close", () => {
      // eslint-disable-next-line no-console
      console.log("[WS] Client disconnected, total:", wss.clients.size);
      rpcServer.close();
    });

    ws.on("error", (err: Error) => {
      console.error("[WS] Client error:", err.message);
    });
  });

  return wss;
}
