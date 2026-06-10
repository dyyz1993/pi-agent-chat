import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const TEST_PORT = 3202;
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
const shouldRun = process.env.PI_E2E_LLM === "1";

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

// =====================================================
// 场景 3: agent.session_status_changed 事件推送
// =====================================================
describe.skipIf(shouldRun === false)("场景3: session_status_changed 事件推送监控", () => {
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

    subscribe(ws, "agent.session_status_changed", {});
    subscribe(ws, "agent.event", { sessionId });

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

  it("启动 agent 后应收到 status=idle", async () => {
    const statusPromise = waitForEvent(
      ws,
      "agent.session_status_changed",
      (msg) => {
        const payload = msg.payload as Record<string, unknown>;
        return payload.status === "idle";
      },
      30000,
    );

    const startResp = await sendRPC(ws, "agent.start", {
      sessionId,
      projectPath: PROJECT_PATH,
      sessionPath,
    });
    expect(startResp.error).toBeUndefined();

    const statusEvent = await statusPromise;
    const payload = statusEvent.payload as Record<string, unknown>;
    expect(payload.status).toBe("idle");
    expect(payload.sessionId).toBe(sessionId);
  });

  it("发送消息 → 应看到 streaming → idle 状态变更", async () => {
    const idlePromise = waitForEvent(
      ws,
      "agent.session_status_changed",
      (msg) => {
        const payload = msg.payload as Record<string, unknown>;
        return payload.status === "idle";
      },
      STREAM_TIMEOUT,
    );

    await sendRPC(ws, "agent.send", {
      sessionId,
      content: "Say just: OK",
    });

    const idleEvent = await idlePromise;
    const payload = idleEvent.payload as Record<string, unknown>;
    expect(payload.status).toBe("idle");
  });

  it("汇总: 所有 status 事件", () => {
    const statusEvents = allEvents.filter((e) => e.eventType === "agent.session_status_changed");
    const statuses = statusEvents.map((e) => (e.payload as Record<string, unknown>).status);

    console.log("\n=== session_status_changed 事件序列 ===");
    console.log(JSON.stringify(statuses, null, 2));

    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses).toContain("streaming");
    expect(statuses).toContain("idle");
  });
});

// =====================================================
// 场景 2: 发消息后标题生成 / session_rename 事件
// =====================================================
describe.skipIf(shouldRun === false)("场景2: 发消息后标题生成事件监控", () => {
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

  it(
    "启动 agent 并发消息，监控所有事件",
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

      await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });

      await sendRPC(ws, "agent.send", {
        sessionId,
        content: "Help me write a hello world function in Python",
      });

      await agentEndPromise;

      await new Promise((r) => setTimeout(r, 5000));
    },
    STREAM_TIMEOUT,
  );

  it("检查 session_rename 事件 (agent.event 内)", () => {
    const renameEvents = allEvents.filter((e) => {
      if (e.eventType !== "agent.event") return false;
      const payload = e.payload as Record<string, unknown>;
      const event = payload.event as Record<string, unknown>;
      return event?.type === "session_rename";
    });

    console.log("\n=== session_rename 事件 (via agent.event) ===");
    console.log(`找到 ${renameEvents.length} 个 session_rename 事件`);
    if (renameEvents.length > 0) {
      for (const evt of renameEvents) {
        const payload = evt.payload as Record<string, unknown>;
        const event = payload.event as Record<string, unknown>;
        console.log(`  oldName: ${(event as Record<string, unknown>).oldName}`);
        console.log(`  newName: ${(event as Record<string, unknown>).newName}`);
      }
    } else {
      console.log("  ⚠️ 没有收到 session_rename 事件!");
    }
  });

  it("检查 agent.session_renamed 独立事件", () => {
    const renamedEvents = allEvents.filter((e) => e.eventType === "agent.session_renamed");

    console.log("\n=== agent.session_renamed 独立事件 ===");
    console.log(`找到 ${renamedEvents.length} 个 session_renamed 事件`);
    if (renamedEvents.length > 0) {
      for (const evt of renamedEvents) {
        console.log("  payload:", JSON.stringify(evt.payload, null, 2));
      }
    } else {
      console.log("  ⚠️ 没有收到 agent.session_renamed 事件!");
    }
  });

  it("汇总: 所有 agent.event 事件类型", () => {
    const agentEvents = allEvents.filter((e) => e.eventType === "agent.event");
    const eventTypes = agentEvents.map((e) => {
      const payload = e.payload as Record<string, unknown>;
      const event = payload.event as Record<string, unknown>;
      return event?.type;
    });

    console.log("\n=== 所有 agent.event 事件类型序列 ===");
    console.log(JSON.stringify(eventTypes, null, 2));

    const uniqueTypes = [...new Set(eventTypes)];
    console.log("\n唯一事件类型:", uniqueTypes.join(", "));
  });
});

// =====================================================
// 场景 1: 委派任务 → coordinator.session_created 事件
// =====================================================
describe.skipIf(shouldRun === false)("场景1: 委派任务 coordinator 事件推送监控", () => {
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
    subscribe(ws, "coordinator.session_event", {});
    subscribe(ws, "subagent.event", {});

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

  it(
    "启动 agent 并发送委派指令",
    async () => {
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

      await sendRPC(ws, "agent.send", {
        sessionId,
        content:
          "Use the session_delegate tool to create a delegated sub-session with task: 'List the files in the current directory'. Title: 'List Files'. Wait for the result, then reply 'Done'.",
      });

      await agentEndPromise;

      await new Promise((r) => setTimeout(r, 8000));
    },
    STREAM_TIMEOUT,
  );

  it("检查 coordinator.session_created 事件", () => {
    const coordinatorEvents = allEvents.filter(
      (e) => e.eventType === "coordinator.session_created",
    );

    console.log("\n=== coordinator.session_created 事件 ===");
    console.log(`找到 ${coordinatorEvents.length} 个 coordinator.session_created 事件`);
    if (coordinatorEvents.length > 0) {
      for (const evt of coordinatorEvents) {
        const payload = evt.payload as Record<string, unknown>;
        const session = payload.session as Record<string, unknown>;
        console.log(`  sessionId: ${session.sessionId}`);
        console.log(`  name: ${session.name}`);
        console.log(`  status: ${session.status}`);
        console.log(`  firstMessage: ${(session.firstMessage as string)?.substring(0, 60)}`);
      }
    } else {
      console.log("  ⚠️ 没有收到 coordinator.session_created 事件!");
      console.log("  可能原因: agent 没有调用 session_delegate 工具");
    }
  });

  it("检查 coordinator.session_event 事件", () => {
    const sessionEvents = allEvents.filter((e) => e.eventType === "coordinator.session_event");

    console.log("\n=== coordinator.session_event 事件 ===");
    console.log(`找到 ${sessionEvents.length} 个 coordinator.session_event 事件`);
    if (sessionEvents.length > 0) {
      for (const evt of sessionEvents) {
        const payload = evt.payload as Record<string, unknown>;
        console.log(`  childSessionId: ${payload.childSessionId}`);
        const event = payload.event as Record<string, unknown>;
        console.log(`  eventType: ${event?.type}`);
      }
    } else {
      console.log("  ⚠️ 没有收到 coordinator.session_event 事件!");
    }
  });

  it("检查 subagent.event 事件", () => {
    const subagentEvents = allEvents.filter((e) => e.eventType === "subagent.event");

    console.log("\n=== subagent.event 事件 ===");
    console.log(`找到 ${subagentEvents.length} 个 subagent.event 事件`);
    if (subagentEvents.length > 0) {
      for (const evt of subagentEvents) {
        const payload = evt.payload as Record<string, unknown>;
        console.log(`  event: ${JSON.stringify(payload).substring(0, 100)}`);
      }
    } else {
      console.log("  ⚠️ 没有收到 subagent.event 事件!");
    }
  });

  it("汇总: 所有事件类型统计", () => {
    const eventCounts: Record<string, number> = {};
    for (const evt of allEvents) {
      const key = evt.eventType ?? "unknown";
      eventCounts[key] = (eventCounts[key] || 0) + 1;
    }

    console.log("\n=== 所有事件类型统计 ===");
    for (const [type, count] of Object.entries(eventCounts)) {
      console.log(`  ${type}: ${count}`);
    }

    console.log(`\n总计: ${allEvents.length} 个事件`);
  });
});
