/**
 * Quick verification: MCP / LSP / Shell event push + reconnect data pull
 *
 * Tests:
 * 1. Project startup → do MCP, LSP, Shell push events?
 * 2. Reconnect → can we pull data (getState, getMessages, etc.)?
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../helpers/integration-server";

const PORT = 3299;
const AUTH_TOKEN = "verify-mcp-lsp-shell";
const WS_URL = `ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`;
const RPC_TIMEOUT = 30_000;

interface Msg {
  id?: string;
  type: string;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string };
  eventType?: string;
  payload?: unknown;
  metadata?: { sessionId?: string };
}

function sendRPC(ws: WebSocket, method: string, params: Record<string, unknown>): Promise<Msg> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), RPC_TIMEOUT);
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Msg;
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch {
        /* ignore */
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

function subscribe(ws: WebSocket, eventType: string, filter: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "subscribe", id: randomUUID(), eventType, filter }));
}

function collectEvents(ws: WebSocket, eventType: string, timeoutMs = 5000): Promise<Msg[]> {
  return new Promise((resolve) => {
    const events: Msg[] = [];
    const timer = setTimeout(() => {
      ws.off("message", handler);
      resolve(events);
    }, timeoutMs);
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Msg;
        if (msg.type === "event" && msg.eventType === eventType) {
          events.push(msg);
        }
      } catch {
        /* ignore */
      }
    };
    ws.on("message", handler);
    void timer;
  });
}

function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: Msg) => boolean,
  timeout = RPC_TIMEOUT,
): Promise<Msg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout: ${eventName}`));
    }, timeout);
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Msg;
        if (msg.type === "event" && msg.eventType === eventName && msg.payload) {
          if (!predicate || predicate(msg)) {
            clearTimeout(timer);
            ws.off("message", handler);
            resolve(msg);
          }
        }
      } catch {
        /* ignore */
      }
    };
    ws.on("message", handler);
  });
}

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("WS connect timeout"));
    }, 15_000);
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

let server: TestServerResult;
let ws: WebSocket;
let sessionId: string;
let sessionPath: string;

beforeAll(async () => {
  server = await startTestServer({ port: PORT, authToken: AUTH_TOKEN, projectPath: process.cwd() });
  ws = await connectWs();

  const resp = await sendRPC(ws, "session.create", { projectPath: process.cwd() });
  if (resp.error) throw new Error(`session.create: ${resp.error.message}`);
  const result = resp.result as { sessionId: string; sessionPath: string };
  sessionId = result.sessionId;
  sessionPath = result.sessionPath;
}, 40_000);

afterAll(async () => {
  if (ws?.readyState === WebSocket.OPEN) {
    try {
      await sendRPC(ws, "agent.stop", { sessionId });
    } catch {
      /* cleanup */
    }
    ws.close();
  }
  await stopTestServer(server);
}, 15_000);

describe("MCP / LSP / Shell Event Push Verification", () => {
  it("step 1: agent.start → session_status_changed push", async () => {
    subscribe(ws, "agent.session_status_changed", {});
    const statusPromise = waitForEvent(
      ws,
      "agent.session_status_changed",
      (msg) => {
        const p = msg.payload as Record<string, unknown>;
        return p.sessionId === sessionId;
      },
      15_000,
    );

    const resp = await sendRPC(ws, "agent.start", {
      sessionId,
      projectPath: process.cwd(),
      sessionPath,
    });
    expect(resp.error).toBeUndefined();
    const result = resp.result as Record<string, unknown>;
    expect(result.status).toBe("started");

    const statusEvent = await statusPromise;
    const payload = statusEvent.payload as Record<string, unknown>;
    expect(payload.status).toBe("idle");
    console.log("[PASS] session_status_changed pushed:", payload.status);
  });

  it("step 2: subscribe bash.event → collect any pushed events", async () => {
    subscribe(ws, "bash.event", { sessionId });
    const bashEvents = collectEvents(ws, "bash.event", 3000);
    const collected = await bashEvents;
    console.log(
      `[INFO] bash.event: ${collected.length} events in 3s (may be 0 if no bash commands yet)`,
    );
  });

  it("step 3: subscribe lsp.event → collect any pushed events", async () => {
    subscribe(ws, "lsp.event", { sessionId });
    const lspEvents = collectEvents(ws, "lsp.event", 3000);
    const collected = await lspEvents;
    console.log(`[INFO] lsp.event: ${collected.length} events in 3s`);
  });

  it("step 4: send prompt with bash tool → bash.event should fire", async () => {
    subscribe(ws, "agent.event", { sessionId });
    subscribe(ws, "bash.event", { sessionId });

    const agentEndPromise = waitForEvent(
      ws,
      "agent.event",
      (msg) => {
        const p = msg.payload as Record<string, unknown>;
        const e = p.event as Record<string, unknown>;
        return e?.type === "agent_end";
      },
      120_000,
    );

    const bashEventPromise = collectEvents(ws, "bash.event", 60_000);

    const resp = await sendRPC(ws, "agent.send", {
      sessionId,
      content: "Run this exact command: echo hello-verify-123",
    });
    expect((resp.result as Record<string, unknown>).ok).toBe(true);

    await agentEndPromise;

    const bashEvents = await bashEventPromise;
    console.log(`[INFO] bash.event after bash tool: ${bashEvents.length} events`);

    if (bashEvents.length > 0) {
      console.log("[PASS] bash.event pushed on tool execution");
    } else {
      console.log("[WARN] No bash.event — bash channel may not be wired for push");
    }
  });

  it("step 5: verify agent_end → session_status_changed push", async () => {
    const statusEvents = await collectEvents(ws, "agent.session_status_changed", 3000);
    const hasIdle = statusEvents.some((e) => {
      const p = e.payload as Record<string, unknown>;
      return p.status === "idle" && p.sessionId === sessionId;
    });
    if (hasIdle) {
      console.log("[PASS] session_status_changed → idle pushed after agent_end");
    } else {
      console.log("[WARN] No idle status push after agent_end");
    }
  });
});

describe("Reconnect Data Pull Verification", () => {
  it("step 6: pull getState — should have data", async () => {
    const resp = await sendRPC(ws, "agent.getState", { sessionId });
    expect(resp.error).toBeUndefined();
    const state = resp.result as Record<string, unknown>;
    console.log(
      "[PASS] getState:",
      JSON.stringify({
        isStreaming: state.isStreaming,
        messageCount: state.messageCount,
        status: state.status,
      }),
    );
    expect(state).toHaveProperty("isStreaming");
  });

  it("step 7: pull getMessages — should have messages from previous turn", async () => {
    const resp = await sendRPC(ws, "agent.getMessages", { sessionId });
    expect(resp.error).toBeUndefined();
    const result = resp.result as { messages: Array<Record<string, unknown>> };
    console.log(`[PASS] getMessages: ${result.messages.length} messages`);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("step 8: pull getAvailableModels — model picker data", async () => {
    const resp = await sendRPC(ws, "agent.getAvailableModels", { sessionId });
    expect(resp.error).toBeUndefined();
    const models = resp.result as Array<Record<string, unknown>>;
    console.log(`[PASS] getAvailableModels: ${models.length} models`);
    expect(models.length).toBeGreaterThan(0);
  });

  it("step 9: pull getExtensions — MCP server tools", async () => {
    const resp = await sendRPC(ws, "agent.getExtensions", { sessionId });
    expect(resp.error).toBeUndefined();
    const exts = resp.result as Record<string, unknown>;
    console.log("[PASS] getExtensions:", Object.keys(exts).length, "keys");
  });

  it("step 10: simulate reconnect — new WS, pull all data again", async () => {
    ws.close();

    const ws2 = await connectWs();
    try {
      const stateResp = await sendRPC(ws2, "agent.getState", { sessionId });
      expect(stateResp.error).toBeUndefined();
      const state = stateResp.result as Record<string, unknown>;
      console.log("[PASS] Reconnect getState:", state.status);

      const msgResp = await sendRPC(ws2, "agent.getMessages", { sessionId });
      expect(msgResp.error).toBeUndefined();
      const msgs = msgResp.result as { messages: Array<Record<string, unknown>> };
      console.log(`[PASS] Reconnect getMessages: ${msgs.messages.length} messages`);
      expect(msgs.messages.length).toBeGreaterThanOrEqual(2);

      const modelResp = await sendRPC(ws2, "agent.getAvailableModels", { sessionId });
      expect(modelResp.error).toBeUndefined();
      const models = modelResp.result as Array<Record<string, unknown>>;
      console.log(`[PASS] Reconnect getAvailableModels: ${models.length} models`);

      const startResp = await sendRPC(ws2, "agent.start", {
        sessionId,
        projectPath: process.cwd(),
        sessionPath,
      });
      const startResult = startResp.result as Record<string, unknown>;
      console.log("[PASS] Reconnect agent.start:", startResult.status);
      expect(["started", "already_running"]).toContain(startResult.status);

      if (startResult.status === "already_running") {
        const replayResp = await sendRPC(ws2, "agent.replayHoldEvents", { sessionId });
        const replayResult = replayResp.result as Record<string, unknown>;
        console.log("[PASS] replayHoldEvents:", replayResult.replayed, "events");
      }
    } finally {
      ws2.close();
    }
  }, 30_000);
});
