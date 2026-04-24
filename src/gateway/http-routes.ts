/**
 * HTTP route handlers for the web gateway.
 * Handles: /health, /info/{path}, /file/{path}, /file/upload
 */

import type { IncomingMessage, ServerResponse } from "http";
import { stat, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { extname, basename, dirname, resolve } from "path";

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
const ALLOWED_ROOTS = [resolve(process.cwd())];
function isPathAllowed(requestedPath: string): boolean {
  const resolved = resolve(requestedPath);
  return ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + "/"));
}

// Token 验证
function verifyToken(req: IncomingMessage, authToken: string): boolean {
  const auth = req.headers["authorization"];
  if (auth === `Bearer ${authToken}`) return true;

  if (req.url) {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.searchParams.get("token") === authToken) return true;
    } catch { /* invalid URL */ }
  }
  return false;
}

export interface HttpRouteDeps {
  config: { readonly port: number; readonly authToken: string; readonly maxUploadSize: number };
  getWebSocketClientCount: () => number;
}

export function createHttpHandler(deps: HttpRouteDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { config: cfg, getWebSocketClientCount } = deps;

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

    // 以下端点需要 Token 鉴权
    if (!verifyToken(req, cfg.authToken)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
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
      await handleFileContent(url.pathname.slice(6), req, res);
      return;
    }

    res.writeHead(404);
    res.end();
  };
}

async function handleFileInfo(encodedPath: string, res: ServerResponse): Promise<void> {
  const filePath = decodeURIComponent(encodedPath);
  if (!isPathAllowed(filePath)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  try {
    const s = await stat(filePath);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      name: basename(filePath),
      path: filePath,
      size: s.size,
      isDirectory: s.isDirectory(),
      modified: s.mtime.toISOString(),
      mimeType: s.isFile() ? (MIME_TYPES[extname(filePath)] || "application/octet-stream") : undefined,
    }));
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "File not found" }));
  }
}

async function handleFileContent(encodedPath: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const filePath = decodeURIComponent(encodedPath);
  if (!isPathAllowed(filePath)) {
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
  if (!isPathAllowed(destPath)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > maxUploadSize) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `File too large, max ${maxUploadSize / 1024 / 1024}MB` }));
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: destPath, size: body.length }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Upload failed" }));
  }
}
