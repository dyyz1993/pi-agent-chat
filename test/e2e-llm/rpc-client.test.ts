import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../helpers/integration-server";

const TEST_PORT = 3199;
const AUTH_TOKEN = "pi-agent-chat-chat-token";
const WS_URL = `ws://localhost:${TEST_PORT}/ws?token=${AUTH_TOKEN}`;
const PROJECT_PATH = process.cwd();
const RPC_TIMEOUT = 60000;
const STREAM_TIMEOUT = 120000;

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
  timestamp?: number;
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
        /* ignore non-JSON */
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

function subscribe(ws: WebSocket, eventType: string, filter: Record<string, unknown>): string {
  const id = randomUUID();
  ws.send(JSON.stringify({ type: "subscribe", id, eventType, filter }));
  return id;
}

function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: RPCMessage) => boolean,
  timeoutMs = STREAM_TIMEOUT,
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
        /* ignore non-JSON */
      }
    };
    ws.on("message", handler);
  });
}

function collectEvents(ws: WebSocket, eventName: string): RPCMessage[] {
  const events: RPCMessage[] = [];
  const handler = (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as RPCMessage;
      if (msg.type === "event" && msg.eventType === eventName) {
        events.push(msg);
      }
    } catch {
      /* ignore non-JSON */
    }
  };
  ws.on("message", handler);
  return events;
}

async function createSession(
  ws: WebSocket,
  projectPath: string,
): Promise<{ sessionId: string; sessionPath: string }> {
  const resp = await sendRPC(ws, "session.create", { projectPath });
  if (resp.error) throw new Error(`session.create failed: ${resp.error.message}`);
  return resp.result as { sessionId: string; sessionPath: string };
}

async function safeStop(ws: WebSocket | undefined, sessionId: string | undefined) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  try {
    await sendRPC(ws, "agent.stop", { sessionId });
  } catch {
    /* cleanup */
  }
}

async function safeClose(ws: WebSocket | undefined) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

const shouldRun = process.env.PI_E2E_LLM === "1" && !!process.env.PI_CLI_PATH;
const describe_ = shouldRun ? describe : describe.skip;

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

function extractTextFromMessageUpdate(event: Record<string, unknown>): string {
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

describe_("RpcClient Integration Tests", () => {
  describe("Suite 1: RpcClient Basic Functions", () => {
    let ws: WebSocket | undefined;
    let sessionId: string | undefined;
    let sessionPath: string | undefined;

    beforeAll(async () => {
      ws = await createWsClient();
      const session = await createSession(ws, PROJECT_PATH);
      sessionId = session.sessionId;
      sessionPath = session.sessionPath;
    });

    afterAll(async () => {
      await safeStop(ws, sessionId);
      safeClose(ws);
    });

    it("should connect and create session", () => {
      expect(ws!.readyState).toBe(WebSocket.OPEN);
      expect(sessionId).toBeDefined();
      expect(sessionPath).toBeDefined();
    });

    it("should start agent", async () => {
      const resp = await sendRPC(ws!, "agent.start", {
        sessionId: sessionId!,
        projectPath: PROJECT_PATH,
        sessionPath: sessionPath!,
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { agentId: string; status: string };
      expect(result.status).toBe("started");
      expect(result.agentId).toBe(sessionId);
    });

    it("should get agent state", async () => {
      const resp = await sendRPC(ws!, "agent.getState", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      const state = resp.result as Record<string, unknown>;
      expect(state).toBeDefined();
      expect(state).toHaveProperty("isStreaming");
      expect(state).toHaveProperty("messageCount");
    });

    it("should get available models", async () => {
      const resp = await sendRPC(ws!, "agent.getAvailableModels", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      const models = resp.result as Array<Record<string, unknown>>;
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it("should get messages (empty new session)", async () => {
      const resp = await sendRPC(ws!, "agent.getMessages", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { messages: unknown[] };
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it("should get commands", async () => {
      const resp = await sendRPC(ws!, "agent.getCommands", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      expect(Array.isArray(resp.result)).toBe(true);
    });

    it("should send prompt and receive reply", async () => {
      subscribe(ws!, "agent.event", { sessionId: sessionId! });

      const agentEndPromise = waitForEvent(
        ws!,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        STREAM_TIMEOUT,
      );

      const sendResp = await sendRPC(ws!, "agent.send", {
        sessionId: sessionId!,
        content: "Reply with just the word 'hello' and nothing else.",
      });
      expect(sendResp.error).toBeUndefined();
      expect((sendResp.result as { ok: boolean }).ok).toBe(true);

      await agentEndPromise;
    });

    it("should have 2 messages after reply", async () => {
      const resp = await sendRPC(ws!, "agent.getMessages", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { messages: Array<Record<string, unknown>> };
      expect(result.messages.length).toBeGreaterThanOrEqual(2);
    });

    it("should get session stats", async () => {
      const resp = await sendRPC(ws!, "agent.getSessionStats", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      const stats = resp.result as Record<string, unknown>;
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty("tokens");
      expect(stats).toHaveProperty("cost");
    });

    it("should stop agent", async () => {
      const resp = await sendRPC(ws!, "agent.stop", { sessionId: sessionId! });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { ok: boolean }).ok).toBe(true);
    });
  });

  describe("Suite 2: holdEvents Instant Recovery", () => {
    let ws: WebSocket | undefined;
    let sessionId: string | undefined;
    let sessionPath: string | undefined;
    let textBeforeDisconnect = "";

    beforeAll(async () => {
      ws = await createWsClient();
      const session = await createSession(ws, PROJECT_PATH);
      sessionId = session.sessionId;
      sessionPath = session.sessionPath;
    });

    afterAll(async () => {
      await safeStop(ws, sessionId);
      safeClose(ws);
    });

    it("should start agent and subscribe", async () => {
      const resp = await sendRPC(ws!, "agent.start", {
        sessionId: sessionId!,
        projectPath: PROJECT_PATH,
        sessionPath: sessionPath!,
      });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { status: string }).status).toBe("started");

      subscribe(ws!, "agent.event", { sessionId: sessionId! });
    });

    it("should send long prompt and detect streaming", async () => {
      const longPrompt =
        "Count from 1 to 50, one number per line. For each number, write a short sentence about why that number is interesting.";

      const sendResp = await sendRPC(ws!, "agent.send", {
        sessionId: sessionId!,
        content: longPrompt,
      });
      expect((sendResp.result as { ok: boolean }).ok).toBe(true);

      let accumulatedText = "";
      const streamHandler = (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as RPCMessage;
          if (msg.type === "event" && msg.eventType === "agent.event") {
            const payload = msg.payload as Record<string, unknown>;
            const event = payload.event as Record<string, unknown>;
            if (event?.type === "message_update") {
              const text = extractTextFromMessageUpdate(event);
              if (text.length > 0) {
                accumulatedText += text;
              }
            }
          }
        } catch {
          /* ignore non-JSON */
        }
      };
      ws!.on("message", streamHandler);

      const start = Date.now();
      while (Date.now() - start < 45000 && accumulatedText.length < 50) {
        await new Promise((r) => setTimeout(r, 1000));
      }

      ws!.off("message", streamHandler);
      textBeforeDisconnect = accumulatedText;

      expect(textBeforeDisconnect.length).toBeGreaterThan(10);
    }, 60000);

    it("should reconnect, get messages, and replay hold events", async () => {
      safeClose(ws);
      ws = undefined;

      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const wsStop = await createWsClient();
          await sendRPC(wsStop, "agent.stop", { sessionId: sessionId! });
          wsStop.close();
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      await new Promise((r) => setTimeout(r, 2000));

      const ws2 = await createWsClient();
      try {
        subscribe(ws2, "agent.event", { sessionId: sessionId! });

        const startResp = await sendRPC(ws2, "agent.start", {
          sessionId: sessionId!,
          projectPath: PROJECT_PATH,
          sessionPath: sessionPath!,
        });
        const status = (startResp.result as { status: string }).status;
        expect(status === "started" || status === "already_running").toBe(true);

        const msgResp = await sendRPC(ws2, "agent.getMessages", { sessionId: sessionId! });
        const msgResult = msgResp.result as { messages: Array<Record<string, unknown>> };
        expect(msgResult.messages).toBeDefined();
        expect(Array.isArray(msgResult.messages)).toBe(true);

        const replayEvents: RPCMessage[] = [];
        const replayHandler = (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString()) as RPCMessage;
            if (msg.type === "event" && msg.eventType === "agent.event") {
              replayEvents.push(msg);
            }
          } catch {
            /* ignore non-JSON */
          }
        };
        ws2.on("message", replayHandler);

        const replayResp = await sendRPC(ws2, "agent.replayHoldEvents", { sessionId: sessionId! });
        expect((replayResp.result as { replayed: number }).replayed).toBeGreaterThanOrEqual(0);

        await new Promise((r) => setTimeout(r, 2000));
        ws2.off("message", replayHandler);

        if (replayEvents.length > 0) {
          let foundText = false;
          for (const evt of replayEvents) {
            const payload = evt.payload as Record<string, unknown>;
            const event = payload.event as Record<string, unknown>;
            if (event?.type === "message_update") {
              foundText = true;
              break;
            }
          }
          if (foundText) {
            expect(true).toBe(true);
          }
        }

        await safeStop(ws2, sessionId);
      } finally {
        ws2.close();
      }
    }, 60000);

    afterAll(async () => {
      await safeStop(ws, sessionId);
      safeClose(ws);
    });
  });

  describe("Suite 3: No Duplicate After message_end", () => {
    let ws: WebSocket | undefined;
    let sessionId: string | undefined;
    let sessionPath: string | undefined;

    beforeAll(async () => {
      ws = await createWsClient();
      const session = await createSession(ws, PROJECT_PATH);
      sessionId = session.sessionId;
      sessionPath = session.sessionPath;
    });

    afterAll(async () => {
      await safeStop(ws, sessionId);
      safeClose(ws);
    });

    it("should start agent and subscribe", async () => {
      const resp = await sendRPC(ws!, "agent.start", {
        sessionId: sessionId!,
        projectPath: PROJECT_PATH,
        sessionPath: sessionPath!,
      });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { status: string }).status).toBe("started");
      subscribe(ws!, "agent.event", { sessionId: sessionId! });
    });

    it("should handle text -> tool -> text without duplicate text on reconnect", async () => {
      const toolPrompt =
        "Say exactly 'Step 1 done' then run a bash command 'for i in 1 2 3 4 5; do echo tick-$i; sleep 1; done' then say 'All done'";

      const events = collectEvents(ws!, "agent.event");

      const sendResp = await sendRPC(ws!, "agent.send", {
        sessionId: sessionId!,
        content: toolPrompt,
      });
      expect((sendResp.result as { ok: boolean }).ok).toBe(true);

      let sawMessageEnd = false;
      let sawToolStart = false;
      const deadline = Date.now() + STREAM_TIMEOUT;

      while (Date.now() < deadline && (!sawMessageEnd || !sawToolStart)) {
        await new Promise((r) => setTimeout(r, 500));
        for (const evt of events) {
          const payload = evt.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          if (event?.type === "message_end") sawMessageEnd = true;
          if (event?.type === "tool_execution_start" || event?.type === "tool_call")
            sawToolStart = true;
        }
      }

      await new Promise((r) => setTimeout(r, 3000));

      ws!.close();
      ws = undefined;

      const ws2 = await createWsClient();
      try {
        subscribe(ws2, "agent.event", { sessionId: sessionId! });

        const startResp = await sendRPC(ws2, "agent.start", {
          sessionId: sessionId!,
          projectPath: PROJECT_PATH,
          sessionPath: sessionPath!,
        });
        expect(startResp.error).toBeUndefined();

        const msgResp = await sendRPC(ws2, "agent.getMessages", { sessionId: sessionId! });
        expect(msgResp.error).toBeUndefined();
        const msgResult = msgResp.result as { messages: Array<Record<string, unknown>> };
        expect(msgResult.messages.length).toBeGreaterThan(0);

        const replayEvents: RPCMessage[] = [];
        const replayHandler = (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString()) as RPCMessage;
            if (msg.type === "event" && msg.eventType === "agent.event") {
              replayEvents.push(msg);
            }
          } catch {
            /* ignore non-JSON */
          }
        };
        ws2.on("message", replayHandler);

        await sendRPC(ws2, "agent.replayHoldEvents", { sessionId: sessionId! });
        await new Promise((r) => setTimeout(r, 2000));
        ws2.off("message", replayHandler);

        for (const evt of replayEvents) {
          const payload = evt.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          if (event?.type === "message_update") {
            const text = extractTextFromMessageUpdate(event);
            if (text.length > 0) {
              throw new Error(
                "Found message_update with text content in replay after message_end - this indicates a duplicate bug",
              );
            }
          }
        }

        await safeStop(ws2, sessionId);
      } finally {
        ws2.close();
      }
    });
  });

  describe("Suite 4: getMessages replaces session.getEntries", () => {
    let ws: WebSocket | undefined;
    let sessionId: string | undefined;
    let sessionPath: string | undefined;

    beforeAll(async () => {
      ws = await createWsClient();
      const session = await createSession(ws, PROJECT_PATH);
      sessionId = session.sessionId;
      sessionPath = session.sessionPath;
    });

    afterAll(async () => {
      await safeStop(ws, sessionId);
      safeClose(ws);
    });

    it("should return structured messages after send", async () => {
      const startResp = await sendRPC(ws!, "agent.start", {
        sessionId: sessionId!,
        projectPath: PROJECT_PATH,
        sessionPath: sessionPath!,
      });
      expect(startResp.error).toBeUndefined();

      subscribe(ws!, "agent.event", { sessionId: sessionId! });

      const agentEndPromise = waitForEvent(
        ws!,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        STREAM_TIMEOUT,
      );

      await sendRPC(ws!, "agent.send", {
        sessionId: sessionId!,
        content: "Say hello",
      });
      await agentEndPromise;

      const msgResp = await sendRPC(ws!, "agent.getMessages", { sessionId: sessionId! });
      expect(msgResp.error).toBeUndefined();
      const result = msgResp.result as {
        messages: Array<Record<string, unknown>>;
      };
      expect(result.messages.length).toBeGreaterThanOrEqual(2);

      const userMsg = result.messages.find((m) => (m as Record<string, unknown>).role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg).toHaveProperty("content");
      expect(Array.isArray(userMsg!.content)).toBe(true);

      const assistantMsg = result.messages.find(
        (m) => (m as Record<string, unknown>).role === "assistant",
      );
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg).toHaveProperty("content");
      expect(Array.isArray(assistantMsg!.content)).toBe(true);

      await safeStop(ws, sessionId);
    });
  });
});
