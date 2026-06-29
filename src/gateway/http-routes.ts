/**
 * HTTP route dispatcher for the web gateway.
 * Handles: /health, /info/{path}, /file/{path}, /file/upload, /fs/{path}
 *
 * Route handler implementations live in ./file-handlers.ts.
 * Path whitelist guard lives in ./path-guard.ts.
 * MIME type mapping lives in ./mime.ts.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { request as httpRequest } from "http";
import { createLogger } from "../shared/lib/logger";
import { createProxyRegistrar } from "./proxy-register";
import { resolveTokenUser, isValidToken } from "./auth";
import {
  handleFsRoute,
  handleFileInfo,
  handleFileContent,
  handleFileUpload,
  handleFileDelete,
  parseFsCookie,
} from "./file-handlers";
import { handleProxyRoute } from "./proxy-routes";
import { handleDebugRoute } from "./debug-routes";

const log = createLogger("gateway");

// Token 验证
function verifyToken(req: IncomingMessage, authToken: string): boolean {
  const auth = req.headers["authorization"];
  if (auth === `Bearer ${authToken}`) return true;

  if (req.url) {
    try {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      if (isValidToken(token, authToken)) return true;
    } catch {
      log.debug("verifyToken: failed to parse request URL for token check");
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

    // Proxy routes (不需要鉴权 — 必须在 auth 之前)
    if (await handleProxyRoute({ url, req, res, proxyRegistrar })) {
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

    // Debug & test routes (鉴权之后)
    if (await handleDebugRoute({ url, req, res, broadcastEvent })) {
      return;
    }

    res.writeHead(404);
    res.end();
  };
}
