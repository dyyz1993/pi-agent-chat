import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { IncomingMessage, ServerResponse } from "http";
import { createHttpHandler, type HttpRouteDeps } from "../../../src/gateway/http-routes";

function createMockIncomingMessage(
  options: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  } = {},
): IncomingMessage {
  const { url = "/", method = "GET", headers = {}, body } = options;
  const chunks: Buffer[] = [];
  if (body) {
    chunks.push(typeof body === "string" ? Buffer.from(body) : body);
  }
  const req = {
    url,
    method,
    headers,
    [Symbol.asyncIterator]() {
      let idx = 0;
      return {
        next: async () => {
          if (idx < chunks.length) return { value: chunks[idx++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
  } as unknown as IncomingMessage;
  return req;
}

function createMockServerResponse(): ServerResponse & {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
} {
  const body = "";
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body,
    headers,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    writeHead(code: number, hdrs?: Record<string, string>) {
      res.statusCode = code;
      if (hdrs) Object.assign(headers, hdrs);
      return res;
    },
    end(data?: string | Buffer) {
      res.body = typeof data === "string" ? data : data?.toString("utf-8") ?? "";
      return res;
    },
  } as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
  return res;
}

describe("file upload HTTP route", () => {
  let tempDir: string;
  let handler: ReturnType<typeof createHttpHandler>;
  const authToken = "test-token-123";
  const maxUploadSize = 1024 * 1024;

  beforeEach(async () => {
    tempDir = join(process.cwd(), `test-tmp-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });

    const deps: HttpRouteDeps = {
      config: { port: 3100, authToken, maxUploadSize },
      getWebSocketClientCount: () => 0,
    };
    handler = createHttpHandler(deps);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function uploadRaw(filePath: string, body: Buffer): Promise<{ status: number; body: string }> {
    const req = createMockIncomingMessage({
      url: `/file/upload?path=${encodeURIComponent(filePath)}&token=${authToken}`,
      method: "POST",
      headers: {
        "content-length": String(body.length),
        "content-type": "application/octet-stream",
      },
      body,
    });
    const res = createMockServerResponse();
    await handler(req, res);
    return { status: res.statusCode, body: res.body };
  }

  it("uploads valid file and returns file URL", async () => {
    const filePath = join(tempDir, "test.txt");
    const content = Buffer.from("Hello, Upload!");

    const result = await uploadRaw(filePath, content);

    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBe(filePath);
    expect(parsed.size).toBe(content.length);

    expect(existsSync(filePath)).toBe(true);
  });

  it("uploads image file as raw body", async () => {
    const filePath = join(tempDir, "photo.jpg");
    const content = Buffer.from("fake-jpeg-data");

    const result = await uploadRaw(filePath, content);

    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.size).toBe(content.length);
    expect(existsSync(filePath)).toBe(true);
  });

  it("rejects oversized file", async () => {
    const filePath = join(tempDir, "big.bin");
    const bigBuffer = Buffer.alloc(maxUploadSize + 100, "x");

    const result = await uploadRaw(filePath, bigBuffer);

    expect(result.status).toBe(413);
    const parsed = JSON.parse(result.body);
    expect(parsed.error).toContain("too large");
  });

  it("rejects upload without authentication", async () => {
    const filePath = join(tempDir, "noauth.txt");
    const req = createMockIncomingMessage({
      url: `/file/upload?path=${encodeURIComponent(filePath)}`,
      method: "POST",
      headers: { "content-length": "10", "content-type": "application/octet-stream" },
      body: Buffer.from("0123456789"),
    });
    const res = createMockServerResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  it("rejects upload to disallowed path", async () => {
    const filePath = "/etc/passwd-hacked";
    const result = await uploadRaw(filePath, Buffer.from("data"));

    expect(result.status).toBe(403);
  });

  it("deletes an uploaded file", async () => {
    const filePath = join(tempDir, "to-delete.txt");
    await writeFile(filePath, "delete me", "utf-8");
    expect(existsSync(filePath)).toBe(true);

    const req = createMockIncomingMessage({
      url: `/file/delete?path=${encodeURIComponent(filePath)}&token=${authToken}`,
      method: "POST",
      headers: {},
    });
    const res = createMockServerResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it("returns 404 when deleting non-existent file", async () => {
    const filePath = join(tempDir, "no-exist.txt");

    const req = createMockIncomingMessage({
      url: `/file/delete?path=${encodeURIComponent(filePath)}&token=${authToken}`,
      method: "POST",
      headers: {},
    });
    const res = createMockServerResponse();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });
});
