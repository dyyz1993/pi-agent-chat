import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import {
  hasPiCliPath,
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "./helpers/integration-server";

const TEST_PORT = 3198;
const AUTH_TOKEN = "pi-agent-chat-diag-token";
const WS_URL = `ws://localhost:${TEST_PORT}/ws?token=${AUTH_TOKEN}`;
const PROJECT_PATH = process.cwd();
const RPC_TIMEOUT = 35000;
const HAS_PI_CLI = process.env.PI_E2E_LLM === "1" && hasPiCliPath();

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
  timeoutMs = RPC_TIMEOUT,
): Promise<RPCMessage> {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timeout = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`RPC call timeout: ${method} (after ${timeoutMs}ms)`));
    }, timeoutMs);

    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.id === id && msg.type === "response") {
          const elapsed = Date.now() - startTime;
          console.log(`  ⏱️  ${method} completed in ${elapsed}ms`);

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

let server: TestServerResult | undefined;

beforeAll(async () => {
  if (!HAS_PI_CLI) return;
  server = await startTestServer({
    port: TEST_PORT,
    authToken: AUTH_TOKEN,
    projectPath: PROJECT_PATH,
  });
}, 40000);

afterAll(async () => {
  if (server) await stopTestServer(server);
});

(HAS_PI_CLI ? describe : describe.skip)("agent.getFullMessages Diagnostics", () => {
  it("should call getFullMessages successfully after agent.start", async () => {
    console.log("\n📝 Test: getFullMessages after agent.start");

    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);
      console.log(`  ✅ Session created: ${sessionId}`);

      // Start agent
      const startResp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });
      expect(startResp.error).toBeUndefined();
      expect((startResp.result as { status: string }).status).toBe("started");
      console.log(`  ✅ Agent started`);

      // Wait a bit for agent to be fully ready
      await new Promise((r) => setTimeout(r, 1000));

      // Test getFullMessages
      console.log("  📡 Calling agent.getFullMessages...");
      const getFullMsgsResp = await sendRPC(ws, "agent.getFullMessages", {
        sessionId,
        sessionPath,
      });

      console.log("  📊 Response:", JSON.stringify(getFullMsgsResp, null, 2));

      expect(getFullMsgsResp.error).toBeUndefined();
      const result = getFullMsgsResp.result as { messages: unknown[]; customEntries: unknown[] };

      console.log(`  ✅ getFullMessages succeeded`);
      console.log(
        `     - Messages count: ${Array.isArray(result.messages) ? result.messages.length : 0}`,
      );
      console.log(
        `     - Custom entries count: ${Array.isArray(result.customEntries) ? result.customEntries.length : 0}`,
      );

      // Cleanup
      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  }, 45000);

  it("should call getFullMessages with existing session file", async () => {
    console.log("\n📝 Test: getFullMessages with existing session file");

    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);
      console.log(`  ✅ Session created: ${sessionId}`);

      // Start agent
      const startResp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });
      expect(startResp.error).toBeUndefined();

      // Send a message to create session data
      await sendRPC(ws, "agent.send", {
        sessionId,
        content: "test message for getFullMessages",
      });

      // Wait for agent to process
      await new Promise((r) => setTimeout(r, 3000));

      // Check session file exists and has content
      try {
        const sessionContent = await readFile(sessionPath, "utf-8");
        const lines = sessionContent.split("\n").filter((l) => l.trim());
        console.log(`  📁 Session file has ${lines.length} lines`);
      } catch (err) {
        console.log(
          `  ⚠️  Could not read session file: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Now call getFullMessages
      console.log("  📡 Calling agent.getFullMessages on populated session...");
      const getFullMsgsResp = await sendRPC(ws, "agent.getFullMessages", {
        sessionId,
        sessionPath,
      });

      expect(getFullMsgsResp.error).toBeUndefined();
      const result = getFullMsgsResp.result as { messages: unknown[]; customEntries: unknown[] };

      console.log(`  ✅ getFullMessages succeeded on populated session`);
      console.log(
        `     - Messages count: ${Array.isArray(result.messages) ? result.messages.length : 0}`,
      );

      // Cleanup
      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  }, 45000);

  it("should handle getFullMessages without agent running", async () => {
    console.log("\n📝 Test: getFullMessages without agent running");

    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);

      console.log("  📡 Calling agent.getFullMessages WITHOUT agent.start...");
      const getFullMsgsResp = await sendRPC(ws, "agent.getFullMessages", {
        sessionId,
        sessionPath,
      });

      console.log("  📊 Response:", JSON.stringify(getFullMsgsResp, null, 2));

      // This should work even without agent running (fallback to file reading)
      expect(getFullMsgsResp.error).toBeUndefined();
      const result = getFullMsgsResp.result as { messages: unknown[]; customEntries: unknown[] };

      console.log(`  ✅ getFullMessages succeeded without agent`);
      console.log(
        `     - Messages count: ${Array.isArray(result.messages) ? result.messages.length : 0}`,
      );
    } finally {
      ws.close();
    }
  }, 35000);

  it("should measure getFullMessages performance", async () => {
    console.log("\n📝 Test: getFullMessages performance measurement");

    const ws = await createWsClient();
    try {
      const { sessionId, sessionPath } = await createSession(ws, PROJECT_PATH);

      // Start agent
      await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: PROJECT_PATH,
        sessionPath,
      });

      await new Promise((r) => setTimeout(r, 1000));

      // Measure 5 consecutive calls
      const durations: number[] = [];
      for (let i = 0; i < 5; i++) {
        const startTime = Date.now();
        await sendRPC(ws, "agent.getFullMessages", {
          sessionId,
          sessionPath,
        });
        const elapsed = Date.now() - startTime;
        durations.push(elapsed);
        console.log(`  📊 Call ${i + 1}: ${elapsed}ms`);
        await new Promise((r) => setTimeout(r, 500)); // Small delay between calls
      }

      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const max = Math.max(...durations);
      const min = Math.min(...durations);

      console.log(`  📈 Performance stats:`);
      console.log(`     - Average: ${avg.toFixed(2)}ms`);
      console.log(`     - Min: ${min}ms`);
      console.log(`     - Max: ${max}ms`);

      // Cleanup
      await sendRPC(ws, "agent.stop", { sessionId });
    } finally {
      ws.close();
    }
  }, 60000);
});
