import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { RPCServer, type Transport } from "@dyyz1993/rpc-core";
import { registerAllHandlers, unregisterAllHandlers } from "../shared/register-all-handlers";
import { createLogger } from "../shared/lib/logger";
import { isValidToken } from "./auth";

const log = createLogger("gateway");

const SLOW_RPC_THRESHOLD_MS = 1000;
const BACKPRESSURE_THRESHOLD = 1024 * 1024; // 1MB
const BACKPRESSURE_DRAIN_TARGET = 512 * 1024; // 512KB

export interface WsHandlerDeps {
  config: { readonly port: number; readonly authToken: string; readonly maxUploadSize: number };
  /** 额外允许的 WebSocket token 集合（例如用户 token） */
  validTokens?: Set<string>;
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
    if (!isValidToken(token, cfg.authToken)) {
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

    // Track RPC timing: id → { method, startTime }
    const rpcTimings = new Map<string, { method: string; startTime: number }>();

    const wsTransport = {
      send: async (message: unknown): Promise<void> => {
        const msg = message as Record<string, unknown>;
        if (ws.readyState !== WebSocket.OPEN) {
          log.debug("[ws-out] stale client: dropping message", {
            type: msg.type,
            id: msg.id,
          });
          return;
        }

        // Backpressure: if send buffer is backing up, handle by message type
        if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
          // Event messages can be dropped during backpressure (next event replaces)
          if (msg.type === "event") {
            log.debug("[ws-out] backpressure: dropping event", { event: msg.eventType });
            return;
          }
          // RPC responses must wait for buffer to drain
          await new Promise<void>((resolve) => {
            const check = () => {
              if (ws.readyState !== WebSocket.OPEN) { resolve(); return; }
              if (ws.bufferedAmount < BACKPRESSURE_DRAIN_TARGET) { resolve(); return; }
              setTimeout(check, 10);
            };
            setTimeout(check, 10);
          });
          if (ws.readyState !== WebSocket.OPEN) {
            log.debug("[ws-out] stale client after backpressure: dropping message", {
              type: msg.type,
              id: msg.id,
            });
            return;
          }
        }

        // Log all outgoing messages (requests, responses, events)
        if (msg.type === "response" && msg.id) {
          const timing = rpcTimings.get(msg.id as string);
          if (timing) {
            const durationMs = Date.now() - timing.startTime;
            rpcTimings.delete(msg.id as string);
            if (durationMs >= SLOW_RPC_THRESHOLD_MS) {
              log.warn("[ws-out] SLOW response", {
                id: msg.id,
                method: timing.method,
                durationMs,
              });
            } else {
              log.info("[ws-out]", {
                type: msg.type,
                id: msg.id,
                method: timing.method,
                durationMs,
              });
            }
          } else {
            log.info("[ws-out]", { type: msg.type, id: msg.id });
          }
        } else {
          // Event messages are high-frequency.
          // Use debug level to avoid excessive log disk IO; info for responses only.
          log.debug("[ws-out]", {
            type: msg.type ?? "unknown",
            method: msg.method,
            event: msg.event,
            id: msg.id,
          });
        }

        return new Promise<void>((resolve, reject) => {
          try {
            ws.send(JSON.stringify(message), (err?: Error) => {
              if (err) {
                log.error("[ws-out] send failed", {
                  type: msg.type,
                  id: msg.id,
                  error: err.message,
                });
                reject(err);
              } else {
                resolve();
              }
            });
          } catch (err) {
            log.error("[ws-out] send exception", {
              type: msg.type,
              id: msg.id,
              error: String(err),
            });
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
      onMessage: (handler: (message: unknown) => void): (() => void) => {
        const listener = (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString()) as Record<string, unknown>;
            // Track RPC request timing
            if (msg.type === "request" && msg.id && msg.method) {
              rpcTimings.set(msg.id as string, {
                method: msg.method as string,
                startTime: Date.now(),
              });
            }
            log.info("[ws-in]", {
              type: msg.type ?? "unknown",
              method: msg.method,
              id: msg.id,
              paramsKeys: msg.params ? Object.keys(msg.params as object) : undefined,
            });
            handler(msg);
          } catch (err) {
            log.error("Failed to parse message", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        };
        ws.on("message", listener);
        return () => ws.off("message", listener);
      },
      onError: (handler: (error: Error) => void): (() => void) => {
        ws.on("error", handler);
        return () => ws.off("error", handler);
      },
      onDisconnect: (handler: () => void): (() => void) => {
        ws.on("close", handler);
        return () => ws.off("close", handler);
      },
      isConnected: (): boolean => ws.readyState === WebSocket.OPEN,
      close: (): void => {},
    };

    const rpcServer = new RPCServer(wsTransport as Transport, {
      onError: (err) => {
        log.error("[rpc] server error", { error: String(err) });
      },
    });
    registerAllHandlers(rpcServer, { platform: "web" });

    ws.on("close", (code: number, reason: Buffer) => {
      clients.delete(ws);
      log.info("Client disconnected", { total: clients.size, code, reason: reason.toString() });
      unregisterAllHandlers(rpcServer);
      rpcServer.close();
    });

    ws.on("error", (err: Error) => {
      log.error("Client error", { error: err.message });
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });

  Object.defineProperty(wss, "clients", {
    get: () => clients,
  });

  return wss;
}
