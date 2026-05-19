import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "./helpers/integration-server";

const TEST_PORT = 3203;
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

describe("Fork 派发测试: 通过 RPC JSON 触发 agent 委派 fork", () => {
  let ws: WebSocket;
  let sessionId: string;
  let sessionPath: string;
  const allEvents: RPCMessage[] = [];

  beforeAll(async () => {
    ws = await createWsClient();
    const session = await sendRPC(ws, "session.create", { projectPath: PROJECT_PATH });
    const result = session.result as { sessionId: string; sessionPath: string };
    sessionId = result.sessionId;
    sessionPath = result.sessionPath;

    subscribe(ws, "agent.event", { sessionId });
    subscribe(ws, "coordinator.session_created", {});
    subscribe(ws, "agent.session_status_changed", {});
    subscribe(ws, "agent.session_renamed", {});

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.type === "event") {
          allEvents.push(msg);
        }
      } catch {
        /* ignore */
      }
    };
    ws.on("message", handler);
  });

  afterAll(async () => {
    await safeStop(ws, sessionId);
    safeClose(ws);
  });

  it("Step 1: 启动 agent", async () => {
    const resp = await sendRPC(ws, "agent.start", {
      sessionId,
      projectPath: PROJECT_PATH,
      sessionPath,
    });
    expect(resp.error).toBeUndefined();
    expect((resp.result as { status: string }).status).toBe("started");
  });

  it(
    "Step 2: 发消息让 agent 委派一个 fork 任务",
    async () => {
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

      const sendResp = await sendRPC(ws, "agent.send", {
        sessionId,
        content:
          "Use the session_delegate tool to delegate this task to a new session: 'List all files in the current directory using the bash tool, then summarize what you find'. Set the title to 'Fork Test'. After delegation, reply with just 'Done'.",
      });
      expect(sendResp.error).toBeUndefined();

      await agentEndPromise;
    },
    STREAM_TIMEOUT,
  );

  it("Step 3: 检查 coordinator.session_created 事件", () => {
    const created = allEvents.filter((e) => e.eventType === "coordinator.session_created");

    console.log("\n=== coordinator.session_created ===");
    console.log(`找到 ${created.length} 个`);
    for (const evt of created) {
      const payload = evt.payload as Record<string, unknown>;
      const session = payload.session as Record<string, unknown>;
      console.log(`  sessionId: ${session.sessionId}`);
      console.log(`  name: ${session.name}`);
      console.log(`  status: ${session.status}`);
      console.log(`  parentSessionId: ${payload.parentSessionId}`);
    }

    expect(created.length).toBeGreaterThanOrEqual(1);
  });

  it("Step 4: 检查 agent.session_status_changed 事件（含子会话）", () => {
    const statusEvents = allEvents.filter((e) => e.eventType === "agent.session_status_changed");

    console.log("\n=== agent.session_status_changed ===");
    console.log(`找到 ${statusEvents.length} 个`);
    const statusBySession: Record<string, string[]> = {};
    for (const evt of statusEvents) {
      const payload = evt.payload as Record<string, unknown>;
      const sid = payload.sessionId as string;
      const status = payload.status as string;
      if (!statusBySession[sid]) statusBySession[sid] = [];
      statusBySession[sid].push(status);
    }
    for (const [sid, statuses] of Object.entries(statusBySession)) {
      const short = sid.length > 20 ? sid.substring(0, 20) + "..." : sid;
      console.log(`  ${short}: ${statuses.join(" → ")}`);
    }
  });

  it("Step 5: 检查 agent.session_renamed 事件", () => {
    const renamedEvents = allEvents.filter((e) => e.eventType === "agent.session_renamed");

    console.log("\n=== agent.session_renamed ===");
    console.log(`找到 ${renamedEvents.length} 个`);
    for (const evt of renamedEvents) {
      const payload = evt.payload as Record<string, unknown>;
      console.log(`  sessionId: ${payload.sessionId}`);
      console.log(`  newName: ${payload.newName}`);
    }
  });

  it("Step 6: 通过 RPC 查看 fork 出的子会话", async () => {
    const created = allEvents.filter((e) => e.eventType === "coordinator.session_created");

    if (created.length === 0) {
      console.log("  ⚠️ 没有 coordinator.session_created，跳过");
      return;
    }

    const firstChild = created[0].payload as Record<string, unknown>;
    const childSession = firstChild.session as Record<string, unknown>;
    const childSessionId = childSession.sessionId as string;

    const msgResp = await sendRPC(ws, "agent.getMessages", {
      sessionId: childSessionId,
    });

    if (msgResp.error) {
      console.log(`  ⚠️ getMessages 失败: ${msgResp.error.message}`);
    } else {
      const result = msgResp.result as { messages: Array<Record<string, unknown>> };
      console.log(`\n=== 子会话消息 (sessionId: ${childSessionId.substring(0, 25)}...) ===`);
      console.log(`消息数: ${result.messages.length}`);
      for (const msg of result.messages) {
        const role = msg.role as string;
        const content = msg.content as Array<Record<string, unknown>>;
        let text = "";
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === "text" && typeof part.text === "string") {
              text += part.text;
            }
          }
        }
        const preview = text.substring(0, 120).replace(/\n/g, " ");
        console.log(`  [${role}] ${preview}${text.length > 120 ? "..." : ""}`);
      }

      expect(result.messages.length).toBeGreaterThan(0);
    }
  });

  it("Step 7: 检查 session 列表是否包含 fork 会话", async () => {
    const scanResp = await sendRPC(ws, "project.scanSessions", {
      projectPath: PROJECT_PATH,
    });
    expect(scanResp.error).toBeUndefined();
    const result = scanResp.result as { sessions: Array<Record<string, unknown>> };

    const forkSessions = result.sessions.filter(
      (s) =>
        (s.sessionId as string).startsWith("sess_coord_") ||
        (s.sessionId as string).startsWith("sess_fork_"),
    );

    console.log("\n=== 磁盘扫描中的委派/fork 会话 ===");
    console.log(`总共 ${result.sessions.length} 个会话，其中 ${forkSessions.length} 个委派/fork`);
    for (const s of forkSessions) {
      console.log(`  ${s.sessionId}: ${s.name}`);
    }
  });

  it("Step 8: 汇总所有事件", () => {
    const eventCounts: Record<string, number> = {};
    for (const evt of allEvents) {
      const key = evt.eventType ?? "unknown";
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }

    console.log("\n=== 所有事件类型统计 ===");
    for (const [type, count] of Object.entries(eventCounts)) {
      console.log(`  ${type}: ${count}`);
    }
    console.log(`总计: ${allEvents.length} 个事件`);
  });
});
