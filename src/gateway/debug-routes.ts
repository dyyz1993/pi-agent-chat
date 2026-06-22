/**
 * Debug & test route handlers for the web gateway.
 * Routes: POST/GET /api/debug-log, POST /api/test/inject, POST /api/test/clear
 *
 * Debug routes are registered AFTER auth so they require a valid token.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { appendFile, readFile } from "fs/promises";
import { createLogger } from "../shared/lib/logger";

const log = createLogger("gateway:debug");

export interface DebugRouteContext {
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  broadcastEvent?: (event: Record<string, unknown>) => void;
}

/**
 * Returns true if the request was handled by a debug/test route.
 */
export async function handleDebugRoute(ctx: DebugRouteContext): Promise<boolean> {
  const { url, req, res, broadcastEvent } = ctx;

  // Debug log endpoint (不需要鉴权，仅开发用)
  if (url.pathname === "/api/debug-log" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer | string>)
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { line?: string };
    await appendFile("logs/debug.log", `${body.line ?? ""}\n`);
    res.writeHead(200).end("ok");
    return true;
  }

  // Debug log read
  if (url.pathname === "/api/debug-log" && req.method === "GET") {
    try {
      const content = await readFile("logs/debug.log", "utf-8").catch(() => "");
      res.writeHead(200, { "Content-Type": "text/plain" }).end(content);
    } catch (err) {
      log.error("debug-log read failed", { error: String(err) });
      res.writeHead(200, { "Content-Type": "text/plain" }).end("");
    }
    return true;
  }

  // TEST endpoint: inject mock agent events for UI testing
  if (url.pathname === "/api/test/inject" && req.method === "POST") {
    if (!broadcastEvent) {
      res.writeHead(500).end(JSON.stringify({ error: "broadcastEvent not available" }));
      return true;
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
      questions?: unknown[];
      multiple?: boolean;
      timeout?: number;
      toolCallId?: string;
      id?: string;
      permissionMeta?: unknown;
      hookMeta?: unknown;
      confirmText?: string;
      cancelText?: string;
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
          id: body.id ?? `test-req-${Date.now()}`,
          method: body.method ?? "confirm",
          title: body.title ?? "Test Request",
          message: body.message ?? "This is a test request",
          options: body.options,
          questions: body.questions,
          multiple: body.multiple,
          timeout: body.timeout,
          toolCallId: body.toolCallId,
          permissionMeta: body.permissionMeta,
          hookMeta: body.hookMeta,
          confirmText: body.confirmText,
          cancelText: body.cancelText,
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
    return true;
  }

  // TEST endpoint: clear all mock requests
  if (url.pathname === "/api/test/clear" && req.method === "POST") {
    if (!broadcastEvent) {
      res.writeHead(500).end(JSON.stringify({ error: "broadcastEvent not available" }));
      return true;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer | string>)
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString()) as { sessionId?: string })
      : {};

    // Send a synthetic clear event. When sessionId is provided it uses the
    // normal agent.event subscription path, so tests can clean the same dock
    // state they injected without touching production runtime state.
    broadcastEvent({
      id: `test-clear-${Date.now()}`,
      type: "event",
      eventType: "agent.event",
      metadata: body.sessionId ? { sessionId: body.sessionId } : {},
      payload: body.sessionId
        ? { sessionId: body.sessionId, event: { type: "test_clear_all" } }
        : { type: "test_clear_all" },
    });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}
