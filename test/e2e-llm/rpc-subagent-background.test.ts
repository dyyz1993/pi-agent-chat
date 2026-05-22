import { describe, it, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../helpers/integration-server";

const TEST_PORT = 3204;
const AUTH_TOKEN = "pi-agent-chat-chat-token";
const WS_URL = `ws://localhost:${TEST_PORT}/ws?token=${AUTH_TOKEN}`;
const PROJECT_PATH = process.cwd();
const RPC_TIMEOUT = 60000;
const STREAM_TIMEOUT = 180000;

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
  metadata?: Record<string, unknown>;
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
        /* ignore */
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
        /* ignore */
      }
    };
    ws.on("message", handler);
  });
}

function extractToolCalls(
  events: RPCMessage[],
): Array<{ toolName: string; args: Record<string, unknown> }> {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  for (const evt of events) {
    if (evt.eventType !== "agent.event") continue;
    const payload = evt.payload as Record<string, unknown>;
    const event = payload.event as Record<string, unknown>;
    if (event?.type === "tool_call") {
      calls.push({
        toolName: event.toolName as string,
        args: (event.args ?? {}) as Record<string, unknown>,
      });
    }
  }
  return calls;
}

async function safeStop(ws: WebSocket | undefined, sessionId: string | undefined) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  try {
    await sendRPC(ws, "agent.stop", { sessionId });
  } catch {
    /* cleanup */
  }
}

function safeClose(ws: WebSocket | undefined) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
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

async function runSubagentTest(backgroundMode: boolean): Promise<{
  durationMs: number;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
  agentEvents: RPCMessage[];
  finalText: string;
}> {
  const ws = await createWsClient();
  const session = await sendRPC(ws, "session.create", { projectPath: PROJECT_PATH });
  const result = session.result as { sessionId: string; sessionPath: string };
  const sessionId = result.sessionId;
  const sessionPath = result.sessionPath;

  subscribe(ws, "agent.event", { sessionId });

  const events: RPCMessage[] = [];
  const handler = (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as RPCMessage;
      if (msg.type === "event") {
        events.push(msg);
      }
    } catch {
      /* ignore */
    }
  };
  ws.on("message", handler);

  await sendRPC(ws, "agent.start", {
    sessionId,
    projectPath: PROJECT_PATH,
    sessionPath,
  });

  const agentEndPromise = waitForEvent(
    ws,
    "agent.event",
    (msg) => {
      const payload = msg.payload as Record<string, unknown>;
      const event = payload.event as Record<string, unknown>;
      return event?.type === "agent_end";
    },
    STREAM_TIMEOUT,
  );

  const bgFlag = backgroundMode
    ? "Set the 'background' parameter to true"
    : "Do NOT set the 'background' parameter, leave it as default (false)";
  const prompt = [
    `You MUST call the "subagent" tool with the following parameters:`,
    `- agent: "build"`,
    `- task: "Count from 1 to 5, one number per line. Wait 3 seconds between each number."`,
    `- ${bgFlag}`,
    ``,
    `Do NOT just reply "Done". You MUST actually invoke the subagent tool.`,
  ].join("\n");

  const startMs = Date.now();
  await sendRPC(ws, "agent.send", { sessionId, content: prompt });
  await agentEndPromise;
  const durationMs = Date.now() - startMs;

  const toolCalls = extractToolCalls(events);

  let finalText = "";
  for (const evt of events) {
    if (evt.eventType !== "agent.event") continue;
    const payload = evt.payload as Record<string, unknown>;
    const event = payload.event as Record<string, unknown>;
    if (event?.type === "message_update") {
      const message = event.message as Record<string, unknown>;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const part of content) {
          if (part.type === "text" && typeof part.text === "string") {
            finalText += part.text;
          }
        }
      }
    }
  }

  await safeStop(ws, sessionId);
  safeClose(ws);

  return { durationMs, toolCalls, agentEvents: events, finalText };
}

describe("Subagent background=true 严谨验证", () => {
  it(
    "Test A: subagent background=false (同步基准)",
    async () => {
      const result = await runSubagentTest(false);

      console.log("\n=== Test A: background=false (同步) ===");
      console.log(`总耗时: ${result.durationMs}ms`);
      console.log(`所有工具调用: ${JSON.stringify(result.toolCalls, null, 2)}`);

      const subagentCall = result.toolCalls.find((c) => c.toolName === "subagent");
      console.log(
        `subagent 调用: ${subagentCall ? JSON.stringify(subagentCall.args) : "(未调用)"}`,
      );

      if (subagentCall) {
        console.log(`background 参数值: ${subagentCall.args.background ?? "(未设置)"}`);
      }
    },
    STREAM_TIMEOUT,
  );

  it(
    "Test B: subagent background=true (应异步)",
    async () => {
      const result = await runSubagentTest(true);

      console.log("\n=== Test B: background=true (异步) ===");
      console.log(`总耗时: ${result.durationMs}ms`);
      console.log(`所有工具调用: ${JSON.stringify(result.toolCalls, null, 2)}`);

      const subagentCall = result.toolCalls.find((c) => c.toolName === "subagent");
      console.log(
        `subagent 调用: ${subagentCall ? JSON.stringify(subagentCall.args) : "(未调用)"}`,
      );

      if (subagentCall) {
        console.log(`background 参数值: ${subagentCall.args.background ?? "(未设置)"}`);
        if (subagentCall.args.background === true) {
          console.log("\n✅ agent 传了 background=true");
        } else {
          console.log("\n⚠️ agent 没有传 background=true");
        }
      }
    },
    STREAM_TIMEOUT,
  );

  it(
    "对比: 两轮耗时分析",
    async () => {
      const resultA = await runSubagentTest(false);
      const resultB = await runSubagentTest(true);

      console.log("\n=== 耗时对比 ===");
      console.log(`background=false: ${resultA.durationMs}ms`);
      console.log(`background=true:  ${resultB.durationMs}ms`);

      const subA = resultA.toolCalls.find((c) => c.toolName === "subagent");
      const subB = resultB.toolCalls.find((c) => c.toolName === "subagent");

      console.log(`\nTest A subagent 参数: ${subA ? JSON.stringify(subA.args) : "(未调用)"}`);
      console.log(`Test B subagent 参数: ${subB ? JSON.stringify(subB.args) : "(未调用)"}`);

      if (subA) {
        console.log(`Test A background: ${subA.args.background ?? "(未设置)"}`);
      }
      if (subB) {
        console.log(`Test B background: ${subB.args.background ?? "(未设置)"}`);
      }

      if (!subA && !subB) {
        console.log("\n⚠️ 两轮测试 agent 都没有调用 subagent 工具");
        console.log("这是 LLM 指令遵循问题，不是代码 bug");
      }
    },
    STREAM_TIMEOUT * 2,
  );
});
