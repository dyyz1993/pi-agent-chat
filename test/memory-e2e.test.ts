import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";


const TEST_PORT = 3198;
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
      } catch { /* noop */ }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

function subscribe(
  ws: WebSocket,
  eventType: string,
  filter: Record<string, unknown>,
): string {
  const id = randomUUID();
  ws.send(
    JSON.stringify({ type: "subscribe", id, eventType, filter }),
  );
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
        if (
          msg.type === "event" &&
          msg.eventType === eventName &&
          msg.payload
        ) {
          if (!predicate || predicate(msg)) {
            clearTimeout(timeout);
            ws.off("message", handler);
            resolve(msg);
          }
        }
      } catch { /* noop */ }
    };
    ws.on("message", handler);
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

async function safeStop(ws: WebSocket | undefined, sessionId: string | undefined) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId) return;
  try { await sendRPC(ws, "agent.stop", { sessionId }); } catch { /* noop */ }
}

function safeClose(ws: WebSocket | undefined) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN);

let serverProc: ChildProcess | null = null;
let tmpSessionDir: string;

beforeAll(async () => {
  tmpSessionDir = join(tmpdir(), `pi-memory-e2e-${Date.now()}`);
  await mkdir(tmpSessionDir, { recursive: true });

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(TEST_PORT),
    AUTH_TOKEN,
    LOG_DIR: join(tmpSessionDir, "logs"),
  };

  serverProc = spawn("bun", ["src/server.ts"], {
    cwd: PROJECT_PATH,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Server startup timeout"));
    }, 15000);

    const check = () => {
      const ws = new WebSocket(WS_URL);
      ws.on("open", () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      });
      ws.on("error", () => {
        setTimeout(check, 500);
      });
    };
    setTimeout(check, 2000);
  });
}, 20000);

afterAll(async () => {
  if (serverProc) {
    serverProc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!serverProc) { resolve(); return; }
      const timeout = setTimeout(() => {
        serverProc?.kill("SIGKILL");
        resolve();
      }, 5000);
      serverProc.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    serverProc = null;
  }
  await rm(tmpSessionDir, { recursive: true, force: true }).catch(() => {});
});

describe("Memory E2E: WebSocket RPC (no agent)", () => {
  it("memory.listFiles returns empty for project with no memory", async () => {
    const ws = await createWsClient();
    try {
      const resp = await sendRPC(ws, "memory.listFiles", {
        projectPath: "/tmp/nonexistent-project-xxx",
      });
      expect(resp.error).toBeUndefined();
      const result = resp.result as { files: unknown[]; entrypointContent: string | null };
      expect(result.files).toEqual([]);
      expect(result.entrypointContent).toBeNull();
    } finally {
      safeClose(ws);
    }
  });

  it("memory.readFile rejects path outside memory directory", async () => {
    const ws = await createWsClient();
    try {
      const resp = await sendRPC(ws, "memory.readFile", {
        filePath: "/etc/passwd",
      });
      expect(resp.error).toBeDefined();
      expect(resp.error!.message).toContain("Path outside memory directory");
    } finally {
      safeClose(ws);
    }
  });
});

describe.skipIf(!hasApiKey)("Memory E2E: Full Chain (agent + memory RPC)", () => {
  it("memory.listFiles returns files after agent conversation", async () => {
    const ws = await createWsClient();
    let sessionId: string | undefined;

    try {
      const session = await createSession(ws, PROJECT_PATH);
      sessionId = session.sessionId;

      const startResp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath: session.sessionPath,
      });
      expect(startResp.error).toBeUndefined();
      expect((startResp.result as { status: string }).status).toBe("started");

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
        content: "Remember: I use vim and dark theme. Store this as a preference.",
      });
      expect(sendResp.error).toBeUndefined();
      expect((sendResp.result as { ok: boolean }).ok).toBe(true);

      await agentEndPromise;

      await new Promise((r) => setTimeout(r, 2000));

      const listResp = await sendRPC(ws, "memory.listFiles", {
        projectPath: PROJECT_PATH,
      });
      expect(listResp.error).toBeUndefined();
      const listResult = listResp.result as {
        files: Array<{ filename: string; filePath: string; description: string | null; type: string | null; mtimeMs: number; size: number }>;
        entrypointContent: string | null;
        memoryDir: string;
      };
      expect(listResult.memoryDir).toBeDefined();

      if (listResult.files.length > 0) {
        const readResp = await sendRPC(ws, "memory.readFile", {
          filePath: listResult.files[0].filePath,
        });
        expect(readResp.error).toBeUndefined();
        const readResult = readResp.result as { content: string; size: number };
        expect(typeof readResult.content).toBe("string");
        expect(readResult.size).toBeGreaterThan(0);
      }

      await safeStop(ws, sessionId);
    } finally {
      await safeStop(ws, sessionId);
      safeClose(ws);
    }
  }, STREAM_TIMEOUT + 30000);
});
