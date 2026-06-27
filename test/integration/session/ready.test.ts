import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const TEST_PORT = 3201;
const AUTH_TOKEN = "pi-agent-chat-chat-token";
const WS_URL = `ws://localhost:${TEST_PORT}/ws?token=${AUTH_TOKEN}`;
const PROJECT_PATH = process.cwd();
const RPC_TIMEOUT = 30000;

interface RPCMessage {
  id: string;
  type: "request" | "response" | "event" | "subscribe" | "unsubscribe";
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  eventType?: string;
  filter?: Record<string, unknown>;
  payload?: unknown;
  metadata?: { sessionId?: string };
}

function createWsClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket connection timeout"));
    }, 15000);
    ws.on("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function sendRPC(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
): Promise<RPCMessage> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      reject(new Error(`RPC call timeout: ${method}`));
    }, RPC_TIMEOUT);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timeout);
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

async function createSession(
  ws: WebSocket,
  projectPath: string,
): Promise<{ sessionId: string; sessionPath: string }> {
  const resp = await sendRPC(ws, "session.create", { projectPath });
  if (resp.error) throw new Error(`session.create failed: ${resp.error.message}`);
  return resp.result as { sessionId: string; sessionPath: string };
}

let server: TestServerResult;

beforeAll(async () => {
  server = await startTestServer({
    port: TEST_PORT,
    authToken: AUTH_TOKEN,
    projectPath: PROJECT_PATH,
  });
}, 40000);

afterAll(async () => {
  await stopTestServer(server);
});

describe("Session Ready Lifecycle", () => {
  it("agent.start should return 'started' on first call", async () => {
    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);

      const resp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });

      expect(resp.error).toBeUndefined();
      const result = resp.result as { status: string };
      expect(result.status).toBe("started");

      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  });

  it("agent.start should return 'already_running' when called twice", async () => {
    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);

      const resp1 = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });
      expect((resp1.result as { status: string }).status).toBe("started");

      const resp2 = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });
      expect(resp2.error).toBeUndefined();
      expect((resp2.result as { status: string }).status).toBe("already_running");

      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  });

  it("should recover sessionReady after WebSocket reconnect", async () => {
    const ws1 = await createWsClient();
    const { sessionId, sessionPath } = await createSession(ws1, PROJECT_PATH);

    const startResp = await sendRPC(ws1, "agent.start", {
      sessionId,
      projectPath: PROJECT_PATH,
      sessionPath,
    });
    expect((startResp.result as { status: string }).status).toBe("started");
    ws1.close();

    await new Promise((r) => setTimeout(r, 1000));

    const ws2 = await createWsClient();
    try {
      const recoverResp = await sendRPC(ws2, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });

      expect(recoverResp.error).toBeUndefined();
      const status = (recoverResp.result as { status: string }).status;
      expect(status === "started" || status === "already_running").toBe(true);

      await sendRPC(ws2, "agent.stop", { sessionId });
    } finally {
      ws2.close();
    }
  });

  it("agent.start on non-existent session should succeed and create new session", async () => {
    const ws = await createWsClient();
    try {
      const fakeSessionId = randomUUID();
      const fakeSessionPath = `/tmp/nonexistent-${Date.now()}/session.jsonl`;

      const resp = await sendRPC(ws, "agent.start", {
        sessionId: fakeSessionId,
        projectPath: PROJECT_PATH,
        sessionPath: fakeSessionPath,
      });

      expect(resp.error).toBeUndefined();
      const result = resp.result as { status: string };
      expect(result.status === "started" || result.status === "already_running").toBe(true);

      await sendRPC(ws, "agent.stop", { sessionId: fakeSessionId });
    } finally {
      ws.close();
    }
  });

  it("should handle rapid session switching without stuck ready state", async () => {
    const ws = await createWsClient();
    try {
      const sessions = await Promise.all([
        createSession(ws, PROJECT_PATH),
        createSession(ws, PROJECT_PATH),
        createSession(ws, PROJECT_PATH),
      ]);

      for (const s of sessions) {
        const resp = await sendRPC(ws, "agent.start", {
          sessionId: s.sessionId,
          projectPath: PROJECT_PATH,
          sessionPath: s.sessionPath,
        });
        expect(resp.error).toBeUndefined();
        const status = (resp.result as { status: string }).status;
        expect(status === "started" || status === "already_running").toBe(true);

        await sendRPC(ws, "agent.stop", { sessionId: s.sessionId });
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      ws.close();
    }
  });

  it("should receive agent events after subscribe-then-start", async () => {
    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);

      const subId = randomUUID();
      ws.send(
        JSON.stringify({
          type: "subscribe",
          id: subId,
          eventType: "agent.event",
          filter: { sessionId },
        }),
      );

      await new Promise((r) => setTimeout(r, 200));

      const agentStartEventPromise = waitForEvent(
        ws,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_start";
        },
        10000,
      );

      const startResp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });
      expect(startResp.error).toBeUndefined();

      await sendRPC(ws, "agent.send", {
        sessionId,
        content: "echo hello",
      });

      const agentStartEvent = await agentStartEventPromise;
      expect(agentStartEvent).toBeDefined();

      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  });
});

function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: RPCMessage) => boolean,
  timeoutMs = 30000,
): Promise<RPCMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.type === "event" && msg.eventType === eventName && msg.payload) {
          if (!predicate || predicate(msg)) {
            clearTimeout(timeout);
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
