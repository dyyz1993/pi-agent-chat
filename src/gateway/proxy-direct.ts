/**
 * Direct path-based proxy for the web gateway.
 *
 * Fallback mode when no external proxy registrar is configured (PROXY_API_URL
 * empty). The gateway itself is publicly reachable on cloud deployments, so
 * `/__proxy__/{host:port}/path` can be forwarded in-place instead of
 * redirecting to an external tunnel service.
 *
 * Target restriction: only loopback and RFC1918 private addresses are allowed,
 * so a public deployment cannot be abused as an open relay to arbitrary hosts.
 *
 * Supports HTTP requests and WebSocket upgrades (dev-server HMR works).
 */
import type { IncomingMessage, ServerResponse } from "http";
import { request as httpRequest } from "http";
import { Duplex } from "stream";
import { createLogger } from "../shared/lib/logger";

const log = createLogger("gateway:proxy");

export interface ProxyTarget {
  host: string;
  port: number;
  path: string;
}

/** Parse /__proxy__/host:port[/path] → ProxyTarget, or null if invalid/restricted. */
export function parseProxyTarget(pathname: string): ProxyTarget | null {
  const rest = pathname.slice("/__proxy__/".length);
  if (!rest) return null;

  const slashIdx = rest.indexOf("/");
  const hostPort = slashIdx >= 0 ? rest.slice(0, slashIdx) : rest;
  const path = slashIdx >= 0 ? rest.slice(slashIdx) : "/";

  const colonIdx = hostPort.lastIndexOf(":");
  if (colonIdx < 0) return null;

  const host = decodeURIComponent(hostPort.slice(0, colonIdx));
  const port = parseInt(hostPort.slice(colonIdx + 1), 10);
  if (!host || isNaN(port) || port <= 0 || port > 65535) return null;

  if (!isAllowedTargetHost(host)) return null;
  return { host, port, path };
}

function isAllowedTargetHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return true;
  }
  // IPv4 private ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

function forwardRequestHeaders(
  req: IncomingMessage,
  targetHost: string,
  targetPort: number,
  keepUpgradeHeaders = false,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (value === undefined) continue;
    if (keepUpgradeHeaders && (lower === "connection" || lower === "upgrade")) {
      headers[key] = value;
      continue;
    }
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    headers[key] = value;
  }
  headers["host"] = `${targetHost}:${targetPort}`;
  return headers;
}

/** Forward an HTTP request through the gateway. */
export function handleDirectProxy(req: IncomingMessage, res: ServerResponse, target: ProxyTarget): void {
  const upstream = httpRequest(
    {
      host: target.host,
      port: target.port,
      path: target.path,
      method: req.method,
      headers: forwardRequestHeaders(req, target.host, target.port),
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    log.warn("Direct proxy upstream error", { target: `${target.host}:${target.port}`, error: err.message });
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end(`Upstream ${target.host}:${target.port} unreachable: ${err.message}`);
  });

  req.pipe(upstream);
}

/** Forward a WebSocket upgrade through the gateway (raw socket piping). */
export function handleDirectProxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, target: ProxyTarget): void {
  const upstreamReq = httpRequest({
    host: target.host,
    port: target.port,
    path: target.path,
    method: "GET",
    headers: forwardRequestHeaders(req, target.host, target.port, true),
  });

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    // Replay the 101 handshake headers to the client socket
    let headerText = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage ?? ""}\r\n`;
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      const vals = Array.isArray(value) ? value : [value];
      for (const v of vals) headerText += `${key}: ${v}\r\n`;
    }
    headerText += "\r\n";
    socket.write(headerText);

    if (upstreamHead?.length) socket.write(upstreamHead);
    if (head?.length) upstreamSocket.write(head);

    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);

    const cleanup = () => {
      upstreamSocket.destroy();
      socket.destroy();
    };
    upstreamSocket.on("error", cleanup);
    socket.on("error", cleanup);
    upstreamSocket.on("close", () => socket.destroy());
    socket.on("close", () => upstreamSocket.destroy());
  });

  upstreamReq.on("error", (err) => {
    log.warn("Direct proxy ws upstream error", { target: `${target.host}:${target.port}`, error: err.message });
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
  });

  // WebSocket upgrade requests have no body; end the request to flush it.
  upstreamReq.end();
}
