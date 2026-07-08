/**
 * C 组 — Steer/Delegate 全链路 RPC 验证
 *
 * 先启动 agent 再测 steer/followUp 能否正确投递。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { randomUUID } from "crypto";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const PORT = 3311;
const AUTH_TOKEN = "steer-delegate-verify";

function sendRPC(ws: WebSocket, method: string, params: Record<string, unknown>, timeout = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), timeout);
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.id === id && msg.type === "response") {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(msg);
        }
      } catch { /* ignore */ }
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

describe("Steer and delegate delivery — RPC verification", () => {
  let server: TestServerResult;
  let ws: WebSocket;
  let sessionId: string;
  let sessionPath: string;
  let projectDir: string;

  beforeAll(async () => {
    projectDir = `/tmp/e2e-steer-test-${Date.now()}`;
    const { mkdirSync } = await import("fs");
    mkdirSync(projectDir, { recursive: true });

    server = await startTestServer({
      port: PORT,
      authToken: AUTH_TOKEN,
      piCliPath: undefined,
      homeDir: undefined,
    });

    ws = await connect(`ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`);

    // Create + start agent
    const createRes = await sendRPC(ws, "session.create", { projectPath: projectDir });
    sessionId = createRes.result?.sessionId as string;
    sessionPath = createRes.result?.sessionPath as string;
    expect(sessionId).toBeTruthy();

    await sendRPC(ws, "agent.start", { sessionId, projectPath: projectDir, sessionPath });
  }, 60_000);

  afterAll(async () => {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    await stopTestServer(server);
  });

  it("agent.setSettings + agent.getSettings round-trip for retry config", async () => {
    await sendRPC(ws, "agent.setSettings", {
      sessionId,
      settings: { retry: { enabled: true, maxRetries: 24, baseDelayMs: 5000, maxDelayMs: 60000 } },
    });

    const res = await sendRPC(ws, "agent.getSettings", { sessionId });
    const settings = res.result as Record<string, unknown> | undefined;
    const retry = settings?.retry as Record<string, unknown> | undefined;

    // After setSettings → getSettings, retry config should be visible.
    // May be in retry or retry.provider due to migration — accept either.
    const maxRetries = retry?.maxRetries ?? (retry?.provider as Record<string, unknown> | undefined)?.maxRetries;
    expect(maxRetries).toBe(24);
  });

  it("agent.steer returns ok:true when agent is alive", async () => {
    const res = await sendRPC(ws, "agent.steer", {
      sessionId,
      content: "steer test message",
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ ok: true });
  });

  it("agent.followUp returns ok:true when agent is alive", async () => {
    const res = await sendRPC(ws, "agent.followUp", {
      sessionId,
      content: "follow-up test message",
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toMatchObject({ ok: true });
  });

  it("agent.getQueue returns steer/followUp arrays", async () => {
    const res = await sendRPC(ws, "agent.getQueue", { sessionId });
    expect(res.error).toBeUndefined();
    const queue = res.result as { steering: string[]; followUp: string[] } | undefined;
    expect(queue).toBeDefined();
    expect(Array.isArray(queue?.steering)).toBe(true);
    expect(Array.isArray(queue?.followUp)).toBe(true);
  });
});
