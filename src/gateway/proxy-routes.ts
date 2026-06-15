/**
 * Proxy route handlers for the web gateway.
 * Routes: /__proxy__/{host:port/path}, POST /api/proxy-check, POST /api/proxy-register
 *
 * All proxy routes are registered BEFORE auth so they don't require a token.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { createLogger } from "../shared/lib/logger";
import type { ProxyRegistrar } from "./proxy-register";

const log = createLogger("gateway:proxy");

export interface ProxyRouteContext {
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  proxyRegistrar: ProxyRegistrar | null;
}

/**
 * Returns true if the request was handled by a proxy route.
 */
export async function handleProxyRoute(ctx: ProxyRouteContext): Promise<boolean> {
  const { url, req, res, proxyRegistrar } = ctx;

  // 端口代理重定向（不需要鉴权，iframe 直接访问）
  if (url.pathname.startsWith("/__proxy__/")) {
    if (!proxyRegistrar) {
      res.writeHead(502, { "Content-Type": "text/plain" }).end("Proxy not configured");
      return true;
    }

    const targetPath = url.pathname.slice("/__proxy__/".length);
    if (!targetPath) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing target");
      return true;
    }

    // targetPath format: "localhost:8080" or "localhost:8080/some/path" or "192.168.0.10:3000/path"
    const slashIdx = targetPath.indexOf("/");
    const hostPort = slashIdx >= 0 ? targetPath.slice(0, slashIdx) : targetPath;
    const remainder = slashIdx >= 0 ? targetPath.slice(slashIdx) : "/";

    const colonIdx = hostPort.lastIndexOf(":");
    if (colonIdx < 0) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid target format");
      return true;
    }

    const host = hostPort.slice(0, colonIdx);
    const port = parseInt(hostPort.slice(colonIdx + 1), 10);
    if (!host || isNaN(port) || port <= 0 || port > 65535) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid host or port");
      return true;
    }

    try {
      const publicUrl = await proxyRegistrar.register(host, port);
      if (!publicUrl) {
        res.writeHead(502, { "Content-Type": "text/plain" }).end("Failed to register proxy");
        return true;
      }
      const redirect = new URL(publicUrl);
      redirect.pathname = remainder;
      if (url.search) redirect.search = url.search;
      log.info("Proxy redirect", { host, port, redirectUrl: redirect.toString() });
      res.writeHead(307, { Location: redirect.toString() }).end();
    } catch (err) {
      log.warn("Proxy register error", { host, port, error: String(err) });
      res.writeHead(502, { "Content-Type": "text/plain" }).end("Proxy registration failed");
    }
    return true;
  }

  // 端口可达性检测（无需鉴权，前端 preview 前调用）
  if (url.pathname === "/api/proxy-check" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer | string>)
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as {
      host?: string;
      port?: number;
    };
    if (!body.host || !body.port || isNaN(body.port)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reachable: false, reason: "Missing host or port" }));
      return true;
    }
    const { checkReachable } = await import("./proxy-register");
    const reachable = await checkReachable(body.host, body.port);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ reachable }));
    return true;
  }

  // 代理注册：前端通过此端点（same-origin）注册本地地址到公网代理（无需鉴权）
  if (url.pathname === "/api/proxy-register" && req.method === "POST") {
    if (!proxyRegistrar) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy not configured" }));
      return true;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer | string>)
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as
      | {
          host?: string;
          port?: number;
        }
      | { target?: string };
    let regHost: string;
    let regPort: number;
    if ("target" in body && body.target) {
      const parts = (body as { target: string }).target.split(":");
      regHost = parts[0];
      regPort = parseInt(parts[1] ?? "80", 10);
    } else if ("host" in body && body.host && "port" in body && body.port) {
      regHost = body.host;
      regPort = body.port;
    } else {
      res.writeHead(400).end(JSON.stringify({ error: "Missing host/port or target" }));
      return true;
    }
    if (isNaN(regPort) || regPort <= 0 || regPort > 65535) {
      res.writeHead(400).end(JSON.stringify({ error: "Invalid port" }));
      return true;
    }
    try {
      const publicUrl = await proxyRegistrar.register(regHost, regPort);
      if (!publicUrl) {
        res.writeHead(502).end(JSON.stringify({ error: "Registration failed" }));
        return true;
      }
      log.info("Proxy registered via API", { host: regHost, port: regPort, publicUrl });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ publicUrl }));
    } catch (err) {
      log.warn("Proxy register API error", { host: regHost, port: regPort, error: String(err) });
      res.writeHead(502).end(JSON.stringify({ error: String(err) }));
    }
    return true;
  }

  return false;
}
