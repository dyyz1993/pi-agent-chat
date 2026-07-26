/**
 * Layer 5: Verify retry config propagates from app to agent via the full
 * app → dev server → fork RPC path.
 *
 * Tests:
 * 1. agent.setSettings({ retry: { maxRetries: 24 } }) persists on the agent
 * 2. agent.getSettings returns the configured values after persistence
 * 3. agent.setSettings with maxDelayMs is accepted and returned
 *
 * Prerequisites:
 * - Dev server running (bun run dev:web) or test server spawned
 * - PI_E2E_LLM=1 to enable e2e-llm tests
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const PORT = 3310;
const AUTH_TOKEN = "retry-config-propagation";

interface Msg {
  id?: string;
  type: string;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function sendRPC(ws: WebSocket, method: string, params: Record<string, unknown>, timeout = 30_000): Promise<Msg> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), timeout);
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Msg;
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timer);
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

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    setTimeout(() => reject(new Error("WebSocket connect timeout")), 10_000);
  });
}

describe("Retry config propagation (app → fork RPC)", () => {
  let server: TestServerResult;
  let ws: WebSocket;
  let sessionId: string;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = `/tmp/e2e-retry-test-${Date.now()}`;
    const { mkdirSync } = await import("fs");
    mkdirSync(projectDir, { recursive: true });

    server = await startTestServer({
      port: PORT,
      authToken: AUTH_TOKEN,
      piCliPath: undefined,
      homeDir: undefined,
    });

    ws = await connect(`ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`);

    // Create session
    const createRes = await sendRPC(ws, "session.create", { projectPath: projectDir });
    sessionId = createRes.result?.sessionId as string;
    expect(sessionId).toBeTruthy();
  }, 60_000);

  afterAll(async () => {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    await stopTestServer(server);
  });

  it("agent.setSettings with retry config is accepted", async () => {
    const res = await sendRPC(ws, "agent.setSettings", {
      sessionId,
      settings: {
        retry: {
          enabled: true,
          maxRetries: 24,
          baseDelayMs: 5000,
          maxDelayMs: 60000,
        },
      },
    });
    expect(res.error).toBeUndefined();
  });

  it("agent.getSettings returns configured maxRetries", async () => {
    const res = await sendRPC(ws, "agent.getSettings", { sessionId });
    expect(res.error).toBeUndefined();
    const settings = res.result as Record<string, unknown> | undefined;
    const retry = settings?.retry as Record<string, unknown> | undefined;
    expect(retry?.maxRetries).toBe(24);
    expect(retry?.enabled).toBe(true);
  });

  it("agent.getSettings returns maxDelayMs", async () => {
    const res = await sendRPC(ws, "agent.getSettings", { sessionId });
    const settings = res.result as Record<string, unknown> | undefined;
    const retry = settings?.retry as Record<string, unknown> | undefined;

    // maxDelayMs might be in retry.maxDelayMs or retry.provider.maxRetryDelayMs
    // depending on whether migration ran. Accept either.
    const directMaxDelay = retry?.maxDelayMs;
    const providerMaxDelay = (retry?.provider as Record<string, unknown> | undefined)?.maxRetryDelayMs;
    expect(directMaxDelay ?? providerMaxDelay).toBe(60000);
  });
});
