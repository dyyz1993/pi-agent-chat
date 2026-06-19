/**
 * File-system route handlers for the gateway.
 *
 * These are the handler implementations behind /fs, /info, /file/* endpoints.
 * The route dispatcher (http-routes.ts) delegates here for the actual file I/O.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { stat, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { extname, basename, dirname } from "path";
import { createLogger } from "../shared/lib/logger";
import { isValidToken } from "./auth";
import { getMimeType } from "./mime";
import { isPathAllowed } from "./path-guard";

const log = createLogger("gateway");

export const FS_COOKIE_NAME = "fs_token";
export const FS_COOKIE_MAX_AGE = 3600;

export function parseFsCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers["cookie"] ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === FS_COOKIE_NAME && v) return v;
  }
  return null;
}

export async function handleFsRoute(
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  authToken: string,
): Promise<void> {
  const queryToken = url.searchParams.get("token");
  const cookieToken = parseFsCookie(req);
  const token = queryToken ?? cookieToken;

  if (!isValidToken(token, authToken)) {
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
    const mimeType = getMimeType(extname(filePath));

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
  } catch (e) {
    log.debug("handleFsRoute: failed to serve file", { filePath, error: String(e) });
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Failed to read file");
  }
}

export async function handleFileInfo(encodedPath: string, res: ServerResponse): Promise<void> {
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
        mimeType: s.isFile() ? getMimeType(extname(filePath)) : undefined,
      }),
    );
  } catch (e) {
    log.debug("handleFileInfo: failed to stat file", { filePath, error: String(e) });
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "File not found" }));
  }
}

export async function handleFileContent(
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
    const mimeType = getMimeType(extname(filePath));

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
  } catch (e) {
    log.debug("handleFileContent: failed to serve file", { filePath, error: String(e) });
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to read file" }));
  }
}

export async function handleFileUpload(
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

export async function handleFileDelete(filePath: string | null, res: ServerResponse): Promise<void> {
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
