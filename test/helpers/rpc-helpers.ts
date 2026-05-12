import WebSocket from "ws";
import { randomUUID } from "crypto";

export interface RPCMessage {
  id: string;
  type: "request" | "response" | "event" | "subscribe" | "unsubscribe";
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
  eventType?: string;
  filter?: Record<string, unknown>;
  payload?: unknown;
  metadata?: { sessionId?: string };
  timestamp?: number;
}

const DEFAULT_TIMEOUT = 60_000;
const CONNECT_TIMEOUT = 15_000;

export function createWsClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, CONNECT_TIMEOUT);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function sendRPC(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<RPCMessage> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      reject(new Error(`RPC call timeout: ${method}`));
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {
        // ignore non-JSON
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

export function subscribe(
  ws: WebSocket,
  eventType: string,
  filter: Record<string, unknown>,
): string {
  const id = randomUUID();
  ws.send(JSON.stringify({ type: "subscribe", id, eventType, filter }));
  return id;
}

export function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: RPCMessage) => boolean,
  timeout = DEFAULT_TIMEOUT,
): Promise<RPCMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.type === "event" && msg.eventType === eventName && msg.payload) {
          if (!predicate || predicate(msg)) {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve(msg);
          }
        }
      } catch {
        // ignore non-JSON
      }
    };
    ws.on("message", handler);
  });
}

export function collectEvents(
  ws: WebSocket,
  eventName: string,
  count: number,
  timeout = DEFAULT_TIMEOUT,
): Promise<RPCMessage[]> {
  return new Promise((resolve) => {
    const events: RPCMessage[] = [];
    const timer = setTimeout(() => {
      ws.off("message", handler);
      resolve(events);
    }, timeout);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.type === "event" && msg.eventType === eventName) {
          events.push(msg);
          if (events.length >= count) {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve(events);
          }
        }
      } catch {
        // ignore non-JSON
      }
    };
    ws.on("message", handler);
  });
}

export function closeWs(ws: WebSocket | undefined): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

export async function createSession(
  ws: WebSocket,
  projectPath: string,
): Promise<{ sessionId: string; sessionPath: string }> {
  const resp = await sendRPC(ws, "session.create", { projectPath });
  if (resp.error) throw new Error(`session.create failed: ${resp.error.message}`);
  return resp.result as { sessionId: string; sessionPath: string };
}

export async function safeStop(
  ws: WebSocket | undefined,
  sessionId: string | undefined,
): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  try {
    await sendRPC(ws, "agent.stop", { sessionId });
  } catch {
    // cleanup
  }
}

export function extractTextFromPayload(event: Record<string, unknown>): string {
  const message = event.message as Record<string, unknown> | undefined;
  if (!message) return "";
  const content = message.content as Array<Record<string, unknown>> | undefined;
  if (!content) return "";
  let combined = "";
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") combined += part.text;
  }
  return combined;
}
