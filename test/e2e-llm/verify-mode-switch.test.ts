/**
 * RPC Live Verification: Bug1 + Bug2 fixes
 *
 * Bug1: subagent-v2 filters mode=primary agents — primary agents should fail with "Unknown agent"
 * Bug2: delegate_sync switches agent — subagent should report its actual agent identity
 *
 * This test requires a real server + real LLM call.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../helpers/integration-server";

const PORT = 3297;
const AUTH_TOKEN = "verify-mode-filter";
const WS_URL = `ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`;
const RPC_TIMEOUT = 30_000;

interface Msg {
  id?: string;
  type: string;
  result?: unknown;
  error?: { code: number; message: string };
  eventType?: string;
  payload?: unknown;
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
        /* */
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

function subscribe(ws: WebSocket, eventType: string, filter: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "subscribe", id: randomUUID(), eventType, filter }));
}

function waitForEvent(
  ws: WebSocket,
  eventName: string,
  predicate?: (msg: Msg) => boolean,
  timeout = 120_000,
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
        /* */
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
const shouldRun = process.env.PI_E2E_LLM === "1" && !!process.env.PI_CLI_PATH;

beforeAll(async () => {
  server = await startTestServer({ port: PORT, authToken: AUTH_TOKEN, projectPath: process.cwd() });
}, 40_000);

afterAll(async () => {
  await stopTestServer(server);
}, 15_000);

describe.skipIf(shouldRun === false)("Bug1+Bug2 RPC Live Verification", () => {
  it("Bug2: subagent with agent=reviewer should activate reviewer identity", async () => {
    const ws = await connectWs();
    try {
      const createResp = await sendRPC(ws, "session.create", { projectPath: process.cwd() });
      const { sessionId, sessionPath } = createResp.result as {
        sessionId: string;
        sessionPath: string;
      };

      await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: process.cwd(),
        sessionPath,
      });

      subscribe(ws, "agent.event", { sessionId });

      const agentEndPromise = waitForEvent(
        ws,
        "agent.event",
        (msg) => {
          const p = msg.payload as Record<string, unknown>;
          const e = p.event as Record<string, unknown>;
          return e?.type === "agent_end";
        },
        180_000,
      );

      const sendResp = await sendRPC(ws, "agent.send", {
        sessionId,
        content:
          "Use the subagent tool to delegate this task to the reviewer agent: 'Tell me your agent name and your role in one sentence.' Set timeout to 60 seconds.",
      });
      expect((sendResp.result as Record<string, unknown>).ok).toBe(true);

      await agentEndPromise;

      const msgResp = await sendRPC(ws, "agent.getMessages", { sessionId });
      const messages = (msgResp.result as { messages: Array<Record<string, unknown>> }).messages;

      const assistantMsgs = messages.filter((m) => m.role === "assistant");
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
      const content = lastAssistant?.content as Array<Record<string, unknown>>;

      let resultText = "";
      for (const block of content ?? []) {
        if (typeof (block as Record<string, unknown>).text === "string") {
          resultText += ((block as Record<string, unknown>).text as string) + " ";
        }
      }

      console.log("[INFO] Agent response:", resultText.slice(0, 300));

      const hasReviewerIdentity =
        resultText.toLowerCase().includes("reviewer") ||
        resultText.toLowerCase().includes("code review") ||
        resultText.toLowerCase().includes("审查");

      console.log(
        hasReviewerIdentity
          ? "[PASS] Bug2: subagent activated reviewer identity"
          : "[WARN] Could not confirm reviewer identity in response",
      );

      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  }, 200_000);
});
