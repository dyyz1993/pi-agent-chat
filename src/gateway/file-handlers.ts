/**
 * File-system route handlers for the gateway.
 *
 * These are the handler implementations behind /fs, /info, /file/* endpoints.
 * The route dispatcher (http-routes.ts) delegates here for the actual file I/O.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { stat, readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import { spawnSync } from "node:child_process";
import { extname, basename, dirname, resolve, posix } from "path";
import { createLogger } from "../shared/lib/logger";
import { isValidToken } from "./auth";
import { getMimeType } from "./mime";
import { isPathAllowed, isPathReadable } from "./path-guard";
import { listRemoteProjects } from "../shared/lib/project-config";
import type { RemoteProjectRecord } from "../shared/modules/project";

const log = createLogger("gateway");

export const FS_COOKIE_NAME = "fs_token";
export const FS_COOKIE_MAX_AGE = 3600;

type HttpFileTarget =
  | { kind: "local"; path: string }
  | { kind: "ssh"; path: string; remote: RemoteProjectRecord };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function relativeLocalIfInside(basePath: string, candidatePath: string): string | null {
  const base = stripTrailingSlash(resolve(basePath));
  const candidate = stripTrailingSlash(resolve(candidatePath));
  if (candidate === base) return "";
  const prefix = `${base}/`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : null;
}

function relativeRemoteIfInside(basePath: string, candidatePath: string): string | null {
  const base = stripTrailingSlash(posix.normalize(basePath));
  const candidate = stripTrailingSlash(posix.normalize(candidatePath));
  if (candidate === base) return "";
  const prefix = `${base}/`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : null;
}

async function resolveHttpFileTarget(inputPath: string): Promise<HttpFileTarget> {
  const remoteProjects = await listRemoteProjects().catch(() => []);
  const localPath = resolve(inputPath);

  for (const remote of remoteProjects) {
    const localSuffix = relativeLocalIfInside(remote.localPath, localPath);
    if (localSuffix !== null) {
      return {
        kind: "ssh",
        path: localSuffix ? posix.join(remote.remotePath, localSuffix) : remote.remotePath,
        remote,
      };
    }

    const remoteSuffix = relativeRemoteIfInside(remote.remotePath, inputPath);
    if (remoteSuffix !== null) {
      return { kind: "ssh", path: posix.normalize(inputPath), remote };
    }
  }

  return { kind: "local", path: localPath };
}

function runSshFileCommand(
  remote: RemoteProjectRecord,
  command: string,
): { stdout: Buffer; stderr: string } {
  const result = spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      ...(remote.sshArgs ?? []),
      remote.host,
      command,
    ],
    { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 },
  );
  const stderr = result.stderr?.toString() ?? "";
  if (result.status !== 0) {
    throw new Error(stderr.trim() || "ssh command failed");
  }
  return { stdout: result.stdout ?? Buffer.alloc(0), stderr };
}

function getRemoteFileSize(
  target: Extract<HttpFileTarget, { kind: "ssh" }>,
): number | "missing" | "directory" {
  const quoted = shellQuote(target.path);
  const result = runSshFileCommand(
    target.remote,
    `if [ ! -e ${quoted} ]; then echo missing; elif [ -d ${quoted} ]; then echo directory; else wc -c < ${quoted}; fi`,
  );
  const text = result.stdout.toString().trim();
  if (text === "missing") return "missing";
  if (text === "directory") return "directory";
  const size = Number.parseInt(text, 10);
  if (!Number.isFinite(size)) throw new Error(`invalid remote file size: ${text}`);
  return size;
}

function readRemoteFileRange(
  target: Extract<HttpFileTarget, { kind: "ssh" }>,
  start?: number,
  count?: number,
): Buffer {
  const quoted = shellQuote(target.path);
  const command =
    start != null && count != null
      ? `dd if=${quoted} bs=1 skip=${start} count=${count} 2>/dev/null`
      : `cat -- ${quoted}`;
  return runSshFileCommand(target.remote, command).stdout;
}

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

  const target = await resolveHttpFileTarget(filePath);
  if (target.kind === "local" && !(await isPathReadable(target.path))) {
    res.writeHead(403, { "Content-Type": "text/plain" }).end("Path not allowed");
    return;
  }

  try {
    const fileSize = target.kind === "local" ? undefined : getRemoteFileSize(target);
    if (fileSize === "missing") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("File not found");
      return;
    }
    if (fileSize === "directory") {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Is a directory");
      return;
    }
    if (target.kind === "local" && !existsSync(target.path)) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("File not found");
      return;
    }
    const s = target.kind === "local" ? await stat(target.path) : null;
    if (s?.isDirectory()) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Is a directory");
      return;
    }
    const size = s?.size ?? fileSize;
    if (typeof size !== "number") {
      res.writeHead(500, { "Content-Type": "text/plain" }).end("Failed to read file size");
      return;
    }
    const mimeType = getMimeType(extname(target.path));

    const range = req.headers["range"];
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": mimeType,
      });
      const buffer =
        target.kind === "local"
          ? await readFile(target.path)
          : readRemoteFileRange(target, start, end - start + 1);
      res.end(target.kind === "local" ? buffer.subarray(start, end + 1) : buffer);
    } else {
      res.writeHead(200, {
        "Content-Length": size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
      });
      const buffer =
        target.kind === "local" ? await readFile(target.path) : readRemoteFileRange(target);
      res.end(buffer);
    }
    log.info("FS served", { path: target.path, target: target.kind });
  } catch (e) {
    log.debug("handleFsRoute: failed to serve file", { filePath, error: String(e) });
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Failed to read file");
  }
}

export async function handleFileInfo(encodedPath: string, res: ServerResponse): Promise<void> {
  const filePath = decodeURIComponent(encodedPath);
  const target = await resolveHttpFileTarget(filePath);
  if (target.kind === "local" && !(await isPathReadable(target.path))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  try {
    const size = target.kind === "local" ? undefined : getRemoteFileSize(target);
    if (size === "missing") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    const s = target.kind === "local" ? await stat(target.path) : null;
    const isDirectory = s?.isDirectory() ?? size === "directory";
    const numericSize = typeof size === "number" ? size : s?.size;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        name: basename(target.path),
        path: target.path,
        size: numericSize,
        isDirectory,
        modified: s?.mtime.toISOString(),
        mimeType: !isDirectory ? getMimeType(extname(target.path)) : undefined,
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
  const target = await resolveHttpFileTarget(filePath);
  if (target.kind === "local" && !(await isPathReadable(target.path))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Path not allowed" }));
    return;
  }
  try {
    const fileSize = target.kind === "local" ? undefined : getRemoteFileSize(target);
    if (fileSize === "missing") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    if (fileSize === "directory") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Is a directory" }));
      return;
    }
    if (target.kind === "local" && !existsSync(target.path)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }
    const s = target.kind === "local" ? await stat(target.path) : null;
    if (s?.isDirectory()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Is a directory" }));
      return;
    }
    const size = s?.size ?? fileSize;
    if (typeof size !== "number") {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read file size" }));
      return;
    }
    const mimeType = getMimeType(extname(target.path));

    const range = req.headers["range"];
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mimeType,
      });
      const buffer =
        target.kind === "local"
          ? await readFile(target.path)
          : readRemoteFileRange(target, start, chunkSize);
      res.end(target.kind === "local" ? buffer.subarray(start, end + 1) : buffer);
    } else {
      res.writeHead(200, {
        "Content-Length": size,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
      });
      const buffer =
        target.kind === "local" ? await readFile(target.path) : readRemoteFileRange(target);
      res.end(buffer);
    }
    log.info("File served", { path: target.path, target: target.kind });
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

export async function handleFileDelete(
  filePath: string | null,
  res: ServerResponse,
): Promise<void> {
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
