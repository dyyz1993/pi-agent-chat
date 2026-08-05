import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { RPCServer, type Transport } from "@dyyz1993/rpc-core";
import { registerAllHandlers, unregisterAllHandlers } from "../shared/register-all-handlers";
import { createLogger } from "../shared/lib/logger";
import { isValidToken } from "./auth";

const log = createLogger("gateway");

const SLOW_RPC_THRESHOLD_MS = 1000;
const BACKPRESSURE_THRESHOLD = 1024 * 1024; // 1MB

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

    // Track alive state for dead-connection detection.
    // Server pings every 30s; if no pong by next cycle, terminate.
    (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    ws.on("pong", () => {
      (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
    });

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

        // Backpressure: if send buffer is backing up, only drop event messages
        // (the next event will replace them). RPC responses MUST be sent —
        // blocking them causes loading spinners to hang for 30s+ on slow clients.
        if (ws.bufferedAmount > BACKPRESSURE_THRESHOLD) {
          if (msg.type === "event") {
            log.debug("[ws-out] backpressure: dropping event", { event: msg.eventType });
            return;
          }
          log.warn("[ws-out] backpressure: sending RPC anyway", {
            type: msg.type,
            id: msg.id,
            buffered: ws.bufferedAmount,
            readyState: ws.readyState,
            remoteAddress: (ws as WebSocket & { remoteAddress?: string }).remoteAddress,
            url: (ws as WebSocket & { url?: string }).url,
            protocol: ws.protocol,
          });
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
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(pingInterval);
        return;
      }
      // Mark as dead; if pong arrives, handler resets to true.
      // Next cycle will terminate if still false.
      const _ws = ws as WebSocket & { isAlive?: boolean };
      if (_ws.isAlive === false) {
        log.warn("Client missed pong, terminating dead connection");
        ws.terminate();
        clearInterval(pingInterval);
        return;
      }
      _ws.isAlive = false;
      ws.ping();
    }, 30000);
  });

  // Sweep all clients for dead connections every 30s.
  // Two termination criteria:
  //   1. isAlive=false  → missed last pong (dead at TCP/JS level)
  //   2. bufferedAmount > STUCK_BUFFER_THRESHOLD for too long → JS layer
  //      isn't draining (e.g. tab suspended, headless test runner stuck).
  //      Without this, a single stuck client fills its send buffer with
  //      tens of MB, blocking subsequent RPC responses for that client.
  const STUCK_BUFFER_THRESHOLD = 5 * 1024 * 1024; // 5MB
  const bufferGrowthSince = new WeakMap<WebSocket, { since: number; amount: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const ws of clients) {
      const _ws = ws as WebSocket & { isAlive?: boolean };
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (_ws.isAlive === false) {
        log.warn("Sweep: terminating dead connection (no pong)");
        ws.terminate();
        continue;
      }
      // Track buffer growth: if a connection has >5MB stuck for >60s,
      // the client isn't draining. Terminate so it can reconnect clean.
      if (ws.bufferedAmount > STUCK_BUFFER_THRESHOLD) {
        const tracked = bufferGrowthSince.get(ws);
        if (!tracked) {
          bufferGrowthSince.set(ws, { since: now, amount: ws.bufferedAmount });
        } else if (now - tracked.since > 60000) {
          log.warn("Sweep: terminating stuck-buffer connection", {
            buffered: ws.bufferedAmount,
            stuckMs: now - tracked.since,
          });
          ws.terminate();
        }
      } else {
        bufferGrowthSince.delete(ws);
      }
    }
  }, 30000);

  Object.defineProperty(wss, "clients", {
    get: () => clients,
  });

  return wss;
}
