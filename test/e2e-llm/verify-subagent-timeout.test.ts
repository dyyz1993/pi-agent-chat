/**
 * Verify: subagent timeout behavior
 *
 * Question: When a subagent is created with a timeout, what happens after timeout expires?
 * 1. Is the subagent forcefully killed/stopped?
 * 2. Is a "timeout approaching" message injected?
 * 3. Does it just return timeout status while the subagent keeps running?
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../helpers/integration-server";

const PORT = 3298;
const AUTH_TOKEN = "verify-subagent-timeout";
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

beforeAll(async () => {
  server = await startTestServer({ port: PORT, authToken: AUTH_TOKEN, projectPath: process.cwd() });
}, 40_000);

afterAll(async () => {
  await stopTestServer(server);
}, 15_000);

describe("Subagent Timeout Verification", () => {
  it("step 1: create session and start agent", async () => {
    const ws = await connectWs();
    try {
      subscribe(ws, "agent.session_status_changed", {});

      const createResp = await sendRPC(ws, "session.create", { projectPath: process.cwd() });
      expect(createResp.error).toBeUndefined();
      const { sessionId, sessionPath } = createResp.result as {
        sessionId: string;
        sessionPath: string;
      };

      const startResp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: process.cwd(),
        sessionPath,
      });
      expect(startResp.error).toBeUndefined();
      console.log("[PASS] session created + agent started:", sessionId);

      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  });

  it("step 2: send prompt that triggers subagent with short timeout (10s)", async () => {
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
      subscribe(ws, "subagent.event", {});
      subscribe(ws, "agent.session_status_changed", {});

      console.log("[INFO] Sending prompt with subagent (timeout=10s)...");

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
        content: `Use the subagent tool to delegate this task with a 10 second timeout: "Count from 1 to 1000 slowly, sleeping 1 second between each number. Write each number to a file called /tmp/count.txt". Make sure to set timeout to 10 seconds.`,
      });
      expect((sendResp.result as Record<string, unknown>).ok).toBe(true);

      const endEvent = await agentEndPromise;
      const endPayload = endEvent.payload as Record<string, unknown>;
      const endData = endPayload.event as Record<string, unknown>;
      console.log("[PASS] Agent turn completed. stopReason:", endData.stopReason);

      const msgResp = await sendRPC(ws, "agent.getMessages", { sessionId });
      const messages = (msgResp.result as { messages: Array<Record<string, unknown>> }).messages;

      const assistantMsgs = messages.filter((m) => m.role === "assistant");
      const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
      const content = lastAssistant?.content as Array<Record<string, unknown>>;

      let foundTimeout = false;
      for (const block of content ?? []) {
        const text = (block as Record<string, unknown>).text as string | undefined;
        if (
          text &&
          (text.toLowerCase().includes("timeout") || text.toLowerCase().includes("timed out"))
        ) {
          foundTimeout = true;
          console.log("[PASS] Found timeout in agent response:", text.slice(0, 200));
          break;
        }

        const details = (block as Record<string, unknown>).details as
          | Record<string, unknown>
          | undefined;
        if (details) {
          const result = details.result as Record<string, unknown> | undefined;
          if (result?.status === "timeout") {
            foundTimeout = true;
            console.log("[PASS] Tool result has status=timeout:", JSON.stringify(result));
            break;
          }
        }
      }

      if (foundTimeout) {
        console.log("[PASS] Subagent timeout was detected and reported");
      } else {
        console.log("[WARN] No timeout indication found in response");
        console.log(
          "[INFO] Last assistant content blocks:",
          JSON.stringify(
            content?.map((b) => ({
              type: b.type,
              text: typeof b.text === "string" ? b.text.slice(0, 100) : undefined,
              detailsType: b.details ? "present" : undefined,
            })),
            null,
            2,
          ),
        );
      }

      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  }, 200_000);
});
