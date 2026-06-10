import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const TEST_PORT = 3201;
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

const shouldRun = process.env.PI_E2E_LLM === "1";

describe.skipIf(shouldRun === false)(
  "E2E: 完整 RPC 流程测试 (创建项目 → 会话 → 发消息 → 收回复)",
  () => {
    let ws: WebSocket;
    let createdProjectPath: string;
    let sessionId: string;
    let sessionPath: string;
    let assistantReplyText = "";
    const testTmpDir = join(tmpdir(), `pi-e2e-test-${Date.now()}`);

    afterAll(async () => {
      await safeStop(ws, sessionId);
      safeClose(ws);
      await rm(testTmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it("Step 1: WebSocket 连接", async () => {
      ws = await createWsClient();
      expect(ws.readyState).toBe(WebSocket.OPEN);
    });

    it("Step 2: system.ping 验证连接", async () => {
      const resp = await sendRPC(ws, "system.ping", {});
      expect(resp.error).toBeUndefined();
      const result = resp.result as { pong: boolean; timestamp: number };
      expect(result.pong).toBe(true);
      expect(typeof result.timestamp).toBe("number");
    });

    it("Step 3: project.createDirectory 创建项目文件夹", async () => {
      await mkdir(testTmpDir, { recursive: true });
      const folderName = `test-project-${Date.now()}`;
      const resp = await sendRPC(ws, "project.createDirectory", {
        parentPath: testTmpDir,
        folderName,
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { path: string };
      expect(result.path).toBeDefined();
      createdProjectPath = result.path;
    });

    it("Step 4: session.create 创建会话", async () => {
      const resp = await sendRPC(ws, "session.create", {
        projectPath: createdProjectPath,
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { sessionId: string; sessionPath: string };
      expect(result.sessionId).toBeDefined();
      expect(result.sessionPath).toBeDefined();
      sessionId = result.sessionId;
      sessionPath = result.sessionPath;
    });

    it("Step 5: agent.start 启动 agent", async () => {
      const resp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: createdProjectPath,
        sessionPath,
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { agentId: string; status: string };
      expect(result.status).toBe("started");
      expect(result.agentId).toBe(sessionId);
    });

    it("Step 6: agent.getState 验证 agent 状态", async () => {
      const resp = await sendRPC(ws, "agent.getState", { sessionId });
      expect(resp.error).toBeUndefined();
      const state = resp.result as Record<string, unknown>;
      expect(state).toHaveProperty("isStreaming");
      expect(state).toHaveProperty("messageCount");
    });

    it("Step 7: agent.getMessages 初始消息为空", async () => {
      const resp = await sendRPC(ws, "agent.getMessages", { sessionId });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { messages: unknown[] };
      expect(Array.isArray(result.messages)).toBe(true);
      expect(result.messages.length).toBe(0);
    });

    it("Step 8: agent.send 发送消息并等待回复", async () => {
      subscribe(ws, "agent.event", { sessionId });

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
        content: "Reply with exactly: HELLO_WORLD_TEST",
      });
      expect(sendResp.error).toBeUndefined();
      expect((sendResp.result as { ok: boolean }).ok).toBe(true);

      await agentEndPromise;
    });

    it("Step 9: agent.getMessages 验证收到回复", async () => {
      const resp = await sendRPC(ws, "agent.getMessages", { sessionId });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { messages: Array<Record<string, unknown>> };
      expect(result.messages.length).toBeGreaterThanOrEqual(2);

      const userMsg = result.messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();

      const assistantMsg = result.messages.find((m) => m.role === "assistant");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBeDefined();

      if (Array.isArray(assistantMsg!.content)) {
        for (const part of assistantMsg!.content as Array<Record<string, unknown>>) {
          if (part.type === "text" && typeof part.text === "string") {
            assistantReplyText += part.text;
          }
        }
      }

      expect(assistantReplyText.length).toBeGreaterThan(0);
    });

    it("Step 10: agent.getSessionStats 验证 token 消耗", async () => {
      const resp = await sendRPC(ws, "agent.getSessionStats", { sessionId });
      expect(resp.error).toBeUndefined();
      const stats = resp.result as { tokens: Record<string, number>; cost: Record<string, number> };
      expect(stats).toHaveProperty("tokens");
      expect(stats).toHaveProperty("cost");
    });

    it("Step 11: agent.stop 停止 agent", async () => {
      const resp = await sendRPC(ws, "agent.stop", { sessionId });
      expect(resp.error).toBeUndefined();
      expect((resp.result as { ok: boolean }).ok).toBe(true);
    });

    it("Step 12: 验证完整流程摘要", () => {
      const summary = {
        projectPath: createdProjectPath,
        sessionId,
        sessionPath,
        assistantReplyLength: assistantReplyText.length,
        replyPreview: assistantReplyText.substring(0, 200),
      };
      expect(summary.projectPath).toContain("test-project-");
      expect(summary.sessionId).toBeDefined();
      expect(summary.assistantReplyLength).toBeGreaterThan(0);
    });
  },
);
