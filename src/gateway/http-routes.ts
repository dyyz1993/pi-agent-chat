/**
 * HTTP route handlers for the web gateway.
 * Handles: /health, /info/{path}, /file/{path}, /file/upload, /fs/{path}
 */

import type { IncomingMessage, ServerResponse } from "http";
import { request as httpRequest } from "http";
import { stat, readFile, writeFile, mkdir, appendFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { extname, basename, dirname, resolve } from "path";
import { createLogger } from "../shared/lib/logger";
import { listRecentProjects, restoreOpenTabs } from "../shared/lib/project-config";
import { createProxyRegistrar } from "./proxy-register";

const log = createLogger("gateway");

declare global {
  var __lastTokenUser: string | undefined;
}

function resolveTokenUser(token: string): string | undefined {
  const tokenUsersRaw = String(process.env.TOKEN_USERS);
  void tokenUsersRaw;
  const pairs = tokenUsersRaw.split(",");
  void pairs;
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const tk = pair.substring(0, eq).trim();
      if (tk === token) return pair.substring(eq + 1).trim();
    }
  }
  return undefined;
}

const FS_COOKIE_NAME = "fs_token";
const FS_COOKIE_MAX_AGE = 3600;

// MIME 类型映射
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".mdc": "text/markdown",
  ".ts": "text/plain",
  ".tsx": "text/plain",
  ".py": "text/plain",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

// 路径白名单校验：阻止路径遍历攻击
const ALLOWED_ROOTS = [
  resolve(process.cwd()),
  resolve("/root"),
  resolve(process.env.HOME ?? "", ".claude", "rules"),
  resolve(process.env.HOME ?? "", ".config", "opencode", "rules"),
  resolve(process.env.HOME ?? "", ".opencode", "rules"),
  resolve("/tmp"),
  resolve("/private/tmp"),
];
let cachedAllowedRoots: string[] | null = null;
let rootsCacheTime = 0;
const ROOTS_CACHE_TTL = 30_000;

async function getAllowedRoots(): Promise<string[]> {
  const now = Date.now();
  if (cachedAllowedRoots && now - rootsCacheTime < ROOTS_CACHE_TTL) return cachedAllowedRoots;
  try {
    const projects = await listRecentProjects();
    const { tabs } = await restoreOpenTabs();
    const tabPaths = tabs.map((t) => resolve(t.path));
    cachedAllowedRoots = [...ALLOWED_ROOTS, ...projects.map((p) => resolve(p.path)), ...tabPaths];
    rootsCacheTime = now;
  } catch {
    cachedAllowedRoots = [...ALLOWED_ROOTS];
  }
  return cachedAllowedRoots;
}

async function isPathAllowed(requestedPath: string): Promise<boolean> {
  const resolved = resolve(requestedPath);
  const roots = await getAllowedRoots();
  return roots.some((root) => resolved === root || resolved.startsWith(root + "/"));
}

// Token 验证
function verifyToken(req: IncomingMessage, authToken: string): boolean {
  const auth = req.headers["authorization"];
  if (auth === `Bearer ${authToken}`) return true;

  if (req.url) {
    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      if (token === authToken) return true;
      if (token) {
        const tokenUsersRaw = String(process.env.TOKEN_USERS);
        void tokenUsersRaw;
        const pairs = tokenUsersRaw.split(",");
        void pairs;
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i].trim();
          const eq = pair.indexOf("=");
          if (eq > 0) {
            const tk = pair.substring(0, eq).trim();
            if (tk === token) {
              globalThis.__lastTokenUser = pair.substring(eq + 1).trim();
              return true;
            }
          }
        }
      }
    } catch {
      /* invalid URL */
    }
  }
  return false;
}

export interface HttpRouteDeps {
  config: {
    readonly port: number;
    readonly authToken: string;
    readonly maxUploadSize: number;
    readonly proxyApiUrl: string;
    readonly proxyPublicDomain: string;
  };
  getWebSocketClientCount: () => number;
  broadcastEvent?: (event: Record<string, unknown>) => void;
  sandboxEnabled?: boolean;
  getSandboxPreviewEndpoint?: (userId: string) => Promise<string | null>;
}

export function createHttpHandler(
  deps: HttpRouteDeps,
): (req: IncomingMessage, res: ServerResponse) => void {
  const {
    config: cfg,
    getWebSocketClientCount,
    broadcastEvent,
    sandboxEnabled,
    getSandboxPreviewEndpoint,
  } = deps;

  function proxyToSandbox(
    previewUrl: string,
    sandboxPath: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const targetUrl = `${previewUrl}/raw${sandboxPath.startsWith("/") ? sandboxPath : "/" + sandboxPath}`;
      const proxyReq = httpRequest(
        targetUrl,
        { method: req.method ?? "GET", headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers as Record<string, string>);
          proxyRes.pipe(res);
          proxyRes.on("end", resolve);
          proxyRes.on("error", reject);
        },
      );
      proxyReq.on("error", reject);
      req.pipe(proxyReq);
    });
  }

  function extractUserId(req: IncomingMessage): string | undefined {
    const url = req.url ? new URL(req.url, "http://localhost") : null;
    const queryToken = url?.searchParams.get("token");
    if (queryToken) {
      const uid = resolveTokenUser(queryToken);
      if (uid) return uid;
    }
    const cookieToken = parseFsCookie(req);
    if (cookieToken) {
      const uid = resolveTokenUser(cookieToken);
      if (uid) return uid;
    }
    const auth = req.headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      const uid = resolveTokenUser(auth.slice(7));
      if (uid) return uid;
    }
    return undefined;
  }

  const proxyRegistrar =
    cfg.proxyApiUrl && cfg.proxyPublicDomain
      ? createProxyRegistrar(cfg.proxyApiUrl, cfg.proxyPublicDomain)
      : null;

  return async (req, res) => {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Range, Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    if (!req.url) {
      res.writeHead(400).end();
      return;
    }

    const url = new URL(req.url, "http://localhost");

    // Health endpoint (不需要鉴权)
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: getWebSocketClientCount() }));
      return;
    }

    // 端口代理重定向（不需要鉴权，iframe 直接访问）
    if (url.pathname.startsWith("/__proxy__/")) {
      if (!proxyRegistrar) {
        res.writeHead(502, { "Content-Type": "text/plain" }).end("Proxy not configured");
        return;
      }

      const targetPath = url.pathname.slice("/__proxy__/".length);
      if (!targetPath) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing target");
        return;
      }

      // targetPath format: "localhost:8080" or "localhost:8080/some/path" or "192.168.0.10:3000/path"
      const slashIdx = targetPath.indexOf("/");
      const hostPort = slashIdx >= 0 ? targetPath.slice(0, slashIdx) : targetPath;
      const remainder = slashIdx >= 0 ? targetPath.slice(slashIdx) : "/";

      const colonIdx = hostPort.lastIndexOf(":");
      if (colonIdx < 0) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid target format");
        return;
      }

      const host = hostPort.slice(0, colonIdx);
      const port = parseInt(hostPort.slice(colonIdx + 1), 10);
      if (!host || isNaN(port) || port <= 0 || port > 65535) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid host or port");
        return;
      }

      try {
        const publicUrl = await proxyRegistrar.register(host, port);
        if (!publicUrl) {
          res.writeHead(502, { "Content-Type": "text/plain" }).end("Failed to register proxy");
          return;
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
      return;
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
        return;
      }
      const { checkReachable } = await import("./proxy-register");
      const reachable = await checkReachable(body.host, body.port);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reachable }));
      return;
    }

    // 代理注册：前端通过此端点（same-origin）注册本地地址到公网代理（无需鉴权）
    if (url.pathname === "/api/proxy-register" && req.method === "POST") {
      if (!proxyRegistrar) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy not configured" }));
        return;
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
        return;
      }
      if (isNaN(regPort) || regPort <= 0 || regPort > 65535) {
        res.writeHead(400).end(JSON.stringify({ error: "Invalid port" }));
        return;
      }
      try {
        const publicUrl = await proxyRegistrar.register(regHost, regPort);
        if (!publicUrl) {
          res.writeHead(502).end(JSON.stringify({ error: "Registration failed" }));
          return;
        }
        log.info("Proxy registered via API", { host: regHost, port: regPort, publicUrl });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ publicUrl }));
      } catch (err) {
        log.warn("Proxy register API error", { host: regHost, port: regPort, error: String(err) });
        res.writeHead(502).end(JSON.stringify({ error: String(err) }));
      }
      return;
    }

    // 以下端点需要 Token 鉴权
    if (!verifyToken(req, cfg.authToken)) {
      log.warn("Auth failed", { path: url.pathname });
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // 文件服务（干净路径，支持 HTML 相对资源）: GET /fs/{path}
    if (url.pathname.startsWith("/fs/")) {
      if (sandboxEnabled && getSandboxPreviewEndpoint) {
        const userId = extractUserId(req);
        if (userId) {
          const previewUrl = await getSandboxPreviewEndpoint(userId);
          if (previewUrl) {
            const filePath = url.pathname.slice(4);
            if (filePath) {
              try {
                await proxyToSandbox(previewUrl, decodeURIComponent(filePath), req, res);
                return;
              } catch (err) {
                log.warn("Sandbox proxy failed, falling back to local", {
                  filePath,
                  error: String(err),
                });
              }
            }
          }
        }
      }
      await handleFsRoute(url, req, res, cfg.authToken);
      return;
    }

    // 文件元数据: GET /info/{path}
    if (url.pathname.startsWith("/info/")) {
      await handleFileInfo(url.pathname.slice(6), res);
      return;
    }

    // 文件内容: GET /file/{path}
    if (url.pathname.startsWith("/file/")) {
      if (url.pathname === "/file/upload" && req.method === "POST") {
        await handleFileUpload(req, url.searchParams.get("path"), res, cfg.maxUploadSize);
        return;
      }
      if (url.pathname === "/file/delete" && req.method === "POST") {
        await handleFileDelete(url.searchParams.get("path"), res);
        return;
      }
      if (sandboxEnabled && getSandboxPreviewEndpoint) {
        const userId = extractUserId(req);
        log.info("[sandbox-file] checking", {
          sandboxEnabled,
          hasEndpoint: !!getSandboxPreviewEndpoint,
          userId,
          path: url.pathname,
        });
        if (userId) {
          const previewUrl = await getSandboxPreviewEndpoint(userId);
          if (previewUrl) {
            const encodedPath = url.pathname.slice(6);
            if (encodedPath) {
              try {
                await proxyToSandbox(previewUrl, decodeURIComponent(encodedPath), req, res);
                return;
              } catch (err) {
                log.warn("Sandbox proxy failed, falling back to local", {
                  path: encodedPath,
                  error: String(err),
                });
              }
            }
          }
        }
      }
      await handleFileContent(url.pathname.slice(6), req, res);
      return;
    }

    // Debug log endpoint (不需要鉴权，仅开发用)
    if (url.pathname === "/api/debug-log" && req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer | string>)
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { line?: string };
      await appendFile("logs/debug.log", `${body.line ?? ""}\n`);
      res.writeHead(200).end("ok");
      return;
    }

    // Debug log read
    if (url.pathname === "/api/debug-log" && req.method === "GET") {
      try {
        const content = await readFile("logs/debug.log", "utf-8").catch(() => "");
        res.writeHead(200, { "Content-Type": "text/plain" }).end(content);
      } catch (err) {
        console.error("[http-routes] debug-log read failed:", err);
        res.writeHead(200, { "Content-Type": "text/plain" }).end("");
      }
      return;
    }

    // TEST endpoint: inject mock agent events for UI testing
    if (url.pathname === "/api/test/inject" && req.method === "POST") {
      if (!broadcastEvent) {
        res.writeHead(500).end(JSON.stringify({ error: "broadcastEvent not available" }));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer | string>)
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        sessionId: string;
        method?: string;
        title?: string;
        message?: string;
        options?: string[];
        multiple?: boolean;
        id?: string;
      };

      const event = {
        id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "event" as const,
        eventType: "agent.event",
        sessionId: body.sessionId,
        metadata: { sessionId: body.sessionId },
        payload: {
          sessionId: body.sessionId,
          event: {
            type: "extension_ui_request",
            id: body.id || `test-req-${Date.now()}`,
            method: body.method || "confirm",
            title: body.title || "Test Request",
            message: body.message || "This is a test request",
            options: body.options,
            multiple: body.multiple,
          },
        },
      };

      broadcastEvent(event);
      log.info("[test-inject] Sent event to clients", {
        sessionId: body.sessionId,
        method: body.method,
      });
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ ok: true, eventId: event.id }));
      return;
    }

    // TEST endpoint: clear all mock requests
    if (url.pathname === "/api/test/clear" && req.method === "POST") {
      if (!broadcastEvent) {
        res.writeHead(500).end(JSON.stringify({ error: "broadcastEvent not available" }));
        return;
      }
      // Send a synthetic clear event
      broadcastEvent({
        id: `test-clear-${Date.now()}`,
        type: "event",
        eventType: "agent.event",
        metadata: {},
        payload: { type: "test_clear_all" },
      });
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

function parseFsCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers["cookie"] ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === FS_COOKIE_NAME && v) return v;
  }
  return null;
}

async function handleFsRoute(
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string,
): Promise<void> {
  const queryToken = url.searchParams.get("token");
  const cookieToken = parseFsCookie(req);
  const token = queryToken ?? cookieToken;

  if (token !== authToken && !(token && resolveTokenUser(token))) {
    res.writeHead(401, { "Content-Type": "text/plain" }).end("Unauthorized");
    return;
  }

  if (queryToken) {
    res.setHeader(
      "Set-Cookie",
      `${FS_COOKIE_NAME}=${authToken}; Path=/fs/; HttpOnly; Max-Age=${FS_COOKIE_MAX_AGE}; SameSite=Strict`,
    );
    res.writeHead(302, { Location: url.pathname }).end();
    return;
  }

  const filePath = url.pathname.slice(4);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("Missing file path");
    return;
  }

  if (!(await isPathAllowed(filePath))) {
    res.writeHead(403, { "Content-Type": "text/plain" }).end("Path not allowed");
    return;
  }

  try {
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("File not found");
      return;
    }
    const s = await stat(filePath);
    if (s.isDirectory()) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Is a directory");
      return;
    }
    const mimeType = MIME_TYPES[extname(filePath)] || "application/octet-stream";

    const range = req.headers["range"];
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : s.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${s.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": mimeType,
      });
      const buffer = await readFile(filePath);
      res.end(buffer.subarray(start, end + 1));
    } else {
      res.writeHead(200, {
        "Content-Length": s.size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
      });
      const buffer = await readFile(filePath);
      res.end(buffer);
    }
    log.info("FS served", { path: filePath });
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Failed to read file");
  }
}

async function handleFileInfo(encodedPath: string, res: ServerResponse): Promise<void> {
  const filePath = decodeURIComponent(encodedPath);
  if (!(await isPathAllowed(filePath))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  try {
    const s = await stat(filePath);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        name: basename(filePath),
        path: filePath,
        size: s.size,
        isDirectory: s.isDirectory(),
        modified: s.mtime.toISOString(),
        mimeType: s.isFile()
          ? MIME_TYPES[extname(filePath)] || "application/octet-stream"
          : undefined,
      }),
    );
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "File not found" }));
  }
}

async function handleFileContent(
  encodedPath: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const filePath = decodeURIComponent(encodedPath);
  if (!(await isPathAllowed(filePath))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  try {
    if (!existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    const s = await stat(filePath);
    const mimeType = MIME_TYPES[extname(filePath)] || "application/octet-stream";

    const range = req.headers["range"];
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : s.size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${s.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mimeType,
      });
      const buffer = await readFile(filePath);
      res.end(buffer.subarray(start, end + 1));
    } else {
      res.writeHead(200, {
        "Content-Length": s.size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
      });
      const buffer = await readFile(filePath);
      res.end(buffer);
    }
    log.info("File served", { path: filePath });
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to read file" }));
  }
}

async function handleFileUpload(
  req: IncomingMessage,
  destPath: string | null,
  res: ServerResponse,
  maxUploadSize: number,
): Promise<void> {
  if (!destPath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing path parameter" }));
    return;
  }
  if (!(await isPathAllowed(destPath))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  if (contentLength > maxUploadSize) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `File too large, max ${maxUploadSize / 1024 / 1024}MB` }));
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, body);
    log.info("File uploaded", { path: destPath, size: body.length });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: destPath, size: body.length }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Upload failed" }));
  }
}

async function handleFileDelete(filePath: string | null, res: ServerResponse): Promise<void> {
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing path parameter" }));
    return;
  }
  const decodedPath = decodeURIComponent(filePath);
  if (!(await isPathAllowed(decodedPath))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  try {
    if (!existsSync(decodedPath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    await unlink(decodedPath);
    log.info("File deleted", { path: decodedPath });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Delete failed" }));
  }
}
