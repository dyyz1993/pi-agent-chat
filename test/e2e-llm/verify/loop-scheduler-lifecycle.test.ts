/**
 * Loop Scheduler real-server lifecycle E2E (requires PI_E2E_LLM=1).
 *
 * Replicates the frontend contract end to end against an isolated local
 * server: create loop → persist settings → agent.reload → becomeScheduler →
 * cron fire → prompt injected into the session → assistant reply → cleanup.
 *
 * Also regression-guards fork 047c35e80 (becomeScheduler syncs loops from
 * settings): after reload the jobs map is empty; becomeScheduler must
 * force-acquire the lease AND sync the persisted loop (synced >= 1), making
 * it visible in getStatus with a concrete nextRun.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { tmpdir } from "os";
import { homedir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { readFileSync, realpathSync } from "fs";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const PORT = 3211;
const AUTH_TOKEN = "pi-agent-chat-chat-token";
const WS_URL = `ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`;
const RPC_TIMEOUT = 60_000;

interface RPCResponse {
  result?: unknown;
  error?: { message: string };
}

interface LoopStatusEntry {
  id: string;
  isRunning: boolean;
  lastRun: number | null;
  nextRun: number | null;
  runCount: number;
  lastError: string | null;
}

let server: TestServerResult;
let ws: WebSocket;
let projectDir: string;
let sessionId = "";
let sessionPath = "";
/** Pre-test snapshot of global settings — the test server symlinks the real
 *  ~/.pi/agent, so the persisted loopScheduler key MUST be restored or it
 *  leaks into every later session (a stray every-minute loop drowned the
 *  goal E2E session the first time this test ran). applyOverrides
 *  deep-merges, so the restore payload carries an explicit loopScheduler. */
let originalSettings: Record<string, unknown> | undefined;
let restoreSettingsPayload: Record<string, unknown> | undefined;
const shouldRun = process.env.PI_E2E_LLM === "1";

function connectWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket connection timeout"));
    }, 15_000);
    socket.on("open", () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

const pending = new Map<string, (msg: RPCResponse) => void>();

function sendRPC(method: string, params: unknown, timeoutMs = RPC_TIMEOUT): Promise<RPCResponse> {
  return new Promise((resolve, reject) => {
    const id = `loop-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, (msg: RPCResponse) => {
      clearTimeout(timeout);
      resolve(msg);
    });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

beforeAll(async () => {
  if (!shouldRun) return;
  projectDir = join(tmpdir(), `pi-loop-e2e-${Date.now()}`);
  await mkdir(projectDir, { recursive: true });
  server = await startTestServer({ port: PORT, authToken: AUTH_TOKEN, projectPath: projectDir });
  ws = await connectWs();
  ws.on("message", (data: WebSocket.RawData) => {
    const msg = JSON.parse(data.toString()) as { id?: string };
    if (msg.id && pending.has(msg.id)) {
      const handler = pending.get(msg.id);
      pending.delete(msg.id);
      handler?.(msg as RPCResponse);
    }
  });
  const resp = await sendRPC("session.create", { projectPath: projectDir });
  if (resp.error) throw new Error(`session.create: ${resp.error.message}`);
  const result = resp.result as { sessionId: string; sessionPath: string };
  sessionId = result.sessionId;
  sessionPath = result.sessionPath;

  const start = await sendRPC("agent.start", { sessionId, projectPath: projectDir, sessionPath }, 90_000);
  if (start.error) throw new Error(`agent.start: ${start.error.message}`);
}, 120_000);

afterAll(async () => {
  if (!shouldRun) return;
  try {
    if (sessionId) {
      // restore persisted settings FIRST (while the agent can still serve RPC)
      if (restoreSettingsPayload) {
        await sendRPC("agent.setSettings", { sessionId, scope: "global", settings: restoreSettingsPayload }, 30_000).catch(() => undefined);
      }
      await sendRPC("loop-scheduler.callChannel", { sessionId, method: "list" }).then((r) => {
        const loops = (r.result as { loops?: Array<{ id: string }> })?.loops ?? [];
        for (const loop of loops) {
          void sendRPC("loop-scheduler.callChannel", { sessionId, method: "remove", args: { id: loop.id } });
        }
      });
      await sendRPC("agent.stop", { sessionId }, 30_000).catch(() => undefined);
    }
  } finally {
    ws?.close();
    await stopTestServer(server);
    await rm(projectDir, { recursive: true, force: true });
  }
}, 60_000);

function findLoopStatus(result: unknown, loopId: string): LoopStatusEntry | null {
  const r = result as { loops?: LoopStatusEntry[] } | undefined;
  const loops = r?.loops;
  return Array.isArray(loops) ? loops.find((l) => l.id === loopId) ?? null : null;
}

describe.skipIf(shouldRun === false)("Loop Scheduler lifecycle (real server, real cron fire)", () => {
  it(
    "create → persist → reload → becomeScheduler (syncs settings) → cron fires → prompt injected",
    async () => {
      const loopPrompt = `收到本条定时消息后，只回复 loop-ok 这一个词，不要做任何其他事情`;

      // 0. clear any loop leaked by a previously-crashed run (defense in depth)
      const preList = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "list" });
      for (const stray of (preList.result as { loops?: Array<{ id: string }> })?.loops ?? []) {
        await sendRPC("loop-scheduler.callChannel", { sessionId, method: "remove", args: { id: stray.id } }, 15_000);
      }

      // 1. invalid cron is rejected
      const bad = await sendRPC("loop-scheduler.callChannel", {
        sessionId,
        method: "create",
        args: { name: "bad", cron: "not-a-cron", prompt: "x", deliverAs: "followUp" },
      });
      expect((bad.result as { ok?: boolean })?.ok).toBe(false);

      // 2. create the real every-minute loop
      const created = await sendRPC("loop-scheduler.callChannel", {
        sessionId,
        method: "create",
        args: { name: "e2e-loop", cron: "* * * * *", prompt: loopPrompt, deliverAs: "followUp" },
      });
      const createResult = created.result as { ok?: boolean; id?: string };
      expect(createResult?.ok).toBe(true);
      const loopId = createResult?.id as string;
      expect(loopId).toBeTruthy();

      // 3. persist via the frontend contract (global settings) + reload runtime
      const settingsResp = await sendRPC("agent.getSettings", { sessionId, scope: "global" });
      const settings = (settingsResp.result as { settings?: Record<string, unknown> })?.settings ?? {};
      originalSettings = { ...settings };
      const persisted = {
        ...settings,
        loopScheduler: {
          loops: [{ id: loopId, name: "e2e-loop", enabled: true, cron: "* * * * *", prompt: loopPrompt, deliverAs: "followUp" }],
        },
      };
      await sendRPC("agent.setSettings", { sessionId, scope: "global", settings: persisted });
      await sendRPC("agent.reload", { sessionId }, 90_000);

      // 4. becomeScheduler after reload — must sync the persisted loop back
      //    (regression guard for the adopt-before-persist empty-jobs bug)
      let synced: number | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        try {
          const become = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "becomeScheduler" }, 15_000);
          const result = become.result as { ok?: boolean; already?: boolean; synced?: number };
          if (result?.ok || result?.already) {
            synced = result.synced ?? (result.already ? 0 : undefined);
            break;
          }
        } catch {
          // runtime still restarting — retry
        }
      }
      expect(synced).toBeGreaterThanOrEqual(1);

      // 5. loop visible in status with a concrete nextRun
      const status = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "getStatus" });
      const entry = findLoopStatus(status.result, loopId);
      expect(entry).not.toBeNull();
      expect(entry?.isRunning).toBe(true);
      expect(entry?.nextRun).not.toBeNull();

      // 6. wait for at least one cron fire (next minute boundary) + LLM reply
      let fired = false;
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        const poll = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "getStatus" }, 15_000);
        const current = findLoopStatus(poll.result, loopId);
        if (current && current.runCount >= 1) {
          fired = true;
          break;
        }
      }
      expect(fired, "cron should fire at least once within 150s").toBe(true);

      // 7. prompt reached the session and the agent replied
      const messagesResp = await sendRPC("agent.getFullMessages", { sessionId, sessionPath }, 30_000);
      const messages = (messagesResp.result as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? [];
      const injected = messages.filter(
        (m) => m.role === "user" && JSON.stringify(m.content).includes("定时消息"),
      );
      const replies = messages.filter((m) => m.role === "assistant" && JSON.stringify(m.content).includes("loop-ok"));
      expect(injected.length).toBeGreaterThanOrEqual(1);
      expect(replies.length).toBeGreaterThanOrEqual(1);

      // 8. remove cleans up
      const removed = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "remove", args: { id: loopId } });
      expect((removed.result as { ok?: boolean })?.ok).toBe(true);
      const finalList = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "list" });
      expect(((finalList.result as { loops?: unknown[] })?.loops ?? []).some((l) => (l as { id: string }).id === loopId)).toBe(false);

      // 9. restore persisted global settings (test server symlinks the real
      //    ~/.pi/agent). applyOverrides deep-merges — OMITTING the
      //    loopScheduler key would keep the loop on disk (that silent leak
      //    once drowned another test's session), so restore must explicitly
      //    write the original loops (empty array when there were none).
      const originalLoopScheduler = (originalSettings as { loopScheduler?: { loops?: unknown[] } })?.loopScheduler ?? { loops: [] };
      const restorePayload = { ...originalSettings, loopScheduler: originalLoopScheduler };
      restoreSettingsPayload = restorePayload;
      const restore = await sendRPC("agent.setSettings", { sessionId, scope: "global", settings: restorePayload }, 30_000);
      expect(restore.error).toBeUndefined();
      // Verify at the DISK level — getSettings may filter non-schema keys.
      const onDisk = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "settings.json"), "utf-8")) as { loopScheduler?: { loops?: unknown[] } };
      expect(onDisk.loopScheduler?.loops ?? []).toEqual(originalLoopScheduler.loops ?? []);
    },
    300_000,
  );
});
