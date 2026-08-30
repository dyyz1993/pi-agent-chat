/**
 * Goal autonomous lifecycle E2E (requires PI_E2E_LLM=1).
 *
 * The L2 tests drive the lifecycle with a fixture contract; this one lets a
 * REAL model draft the contract itself — the exact user path:
 * startSetup → (model may ask at most N clarification questions; the test
 * auto-replies to unblock) → model calls pi_goal_submit_contract →
 * awaiting_approval → approveContract → running → model runs approved checks
 * → isolated audit → completed.
 *
 * Guards the production regressions the fixture path cannot see: contract
 * hijack alignment check accepting a faithful draft, authority format
 * self-repair after one rejection, and setup-guard tool blocking with
 * actionable denials.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { realpathSync } from "fs";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";

const PORT = 3212;
const AUTH_TOKEN = "pi-agent-chat-chat-token";
const WS_URL = `ws://localhost:${PORT}/ws?token=${AUTH_TOKEN}`;
const RPC_TIMEOUT = 60_000;

/** Objective is fully specified so a reasonable model drafts without
 *  questions; verification is mechanical (file_exists/file_contains) so the
 *  run passes without browser tooling. */
const OBJECTIVE = `在当前工作区创建一个 index.html 和 README.md，实现一个极简静态倒计时页面，要求一次说明清楚、无需再向我提问：
- index.html：标题为"Focus Timer"，页面正中央显示大号数字 25:00，下方一行小字"专注 25 分钟"；纯 vanilla HTML/CSS，无需任何 JavaScript 逻辑，无外部资源引用
- README.md：中文说明这是什么页面、如何打开
请直接起草并提交完整契约，然后执行到全部机械校验通过。`;

interface RPCResponse {
  result?: unknown;
  error?: { message: string };
}

interface GoalStatus {
  state?: string;
  rawStatus?: string;
  rawPhase?: string;
}

let server: TestServerResult;
let ws: WebSocket;
let projectDir: string;
let sessionId = "";
let sessionPath = "";
const shouldRun = process.env.PI_E2E_LLM === "1";

const pending = new Map<string, (msg: RPCResponse) => void>();

function sendRPC(method: string, params: unknown, timeoutMs = RPC_TIMEOUT): Promise<RPCResponse> {
  return new Promise((resolve, reject) => {
    const id = `goal-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

beforeAll(async () => {
  if (!shouldRun) return;
  // realpathSync: on macOS tmpdir() is /var/folders/... while goal-vendor
  // canonicalizes workspace roots to /private/var/folders/... — without this
  // the model's absolute check paths get rejected as leaving the workspace
  // (the same /var ↔ /private/var trap the fork's own tests realpath around).
  projectDir = join(tmpdir(), `pi-goal-auto-e2e-${Date.now()}`);
  await mkdir(projectDir, { recursive: true });
  projectDir = realpathSync(projectDir);
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

  // Local ~/.pi/agent/models.json may have no defaultProvider/defaultModel, in
  // which case the CLI falls back to a built-in alias that does not exist
  // locally and every turn errors out. Pin an explicit model (overridable).
  const model = process.env.PI_E2E_LLM_MODEL ?? "zai/glm-5.1";
  const setModel = await sendRPC("agent.setModel", { sessionId, model }, 30_000).catch((err: Error) => err);
  if (setModel instanceof Error || setModel?.error) {
    throw new Error(`agent.setModel(${model}) failed: ${setModel instanceof Error ? setModel.message : setModel.error?.message}`);
  }

  // Defend against leaked global loops (a stray every-minute loop message
  // once drowned the setup conversation). Remove any inherited loops first.
  const loopsResp = await sendRPC("loop-scheduler.callChannel", { sessionId, method: "list" }).catch(() => null);
  const strayLoops = (loopsResp?.result as { loops?: Array<{ id: string }> })?.loops ?? [];
  for (const stray of strayLoops) {
    await sendRPC("loop-scheduler.callChannel", { sessionId, method: "remove", args: { id: stray.id } }, 15_000).catch(() => undefined);
  }

  const setup = await sendRPC("goal.startSetup", { sessionId, objective: OBJECTIVE }, 60_000);
  if (setup.error) throw new Error(`goal.startSetup: ${setup.error.message}`);
}, 150_000);

afterAll(async () => {
  if (!shouldRun) return;
  try {
    if (sessionId) {
      await sendRPC("goal.clearGoal", { sessionId }, 30_000).catch(() => undefined);
      await sendRPC("agent.stop", { sessionId }, 30_000).catch(() => undefined);
    }
  } finally {
    ws?.close();
    await stopTestServer(server);
    await rm(projectDir, { recursive: true, force: true });
  }
}, 60_000);

describe.skipIf(shouldRun === false)("Goal autonomous lifecycle (real model drafts the contract)", () => {
  it(
    "startSetup → model-drafted contract → approve → run → audit → completed",
    async () => {
      const TERMINAL = new Set(["completed", "failed", "cancelled", "capped"]);
      let approved = false;
      let autoReplies = 0;
      let sawContract = false;
      let lastRawStatus = "";
      let lastStatusChange = Date.now();
      const deadline = Date.now() + 18 * 60_000;

      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));

        const statusResp = await sendRPC("goal.getStatus", { sessionId }, 30_000).catch(() => null);
        const status = (statusResp?.result ?? {}) as GoalStatus;
        const raw = status.rawStatus ?? status.state ?? "?";
        if (raw !== lastRawStatus) {
          lastRawStatus = raw;
          lastStatusChange = Date.now();
        }
        if (TERMINAL.has(raw)) break;
        // Fail fast with diagnostics instead of burning the whole budget when
        // the goal is wedged (e.g. every model turn erroring out).
        if (Date.now() - lastStatusChange > 6 * 60_000 && raw === "setting_up") {
          const messagesResp = await sendRPC("agent.getFullMessages", { sessionId, sessionPath }, 30_000).catch(() => null);
          const messages = (messagesResp?.result as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? [];
          const tail = messages.slice(-5).map((m) => `[${m.role}] ${JSON.stringify(m.content).slice(0, 200)}`);
          throw new Error(`goal stuck in setting_up for >6min. Last messages:\n${tail.join("\n")}`);
        }

        if (raw === "awaiting_approval" && !approved) {
          // inspect the model-drafted contract before approving
          const contractResp = await sendRPC("goal.getPendingContract", { sessionId }, 30_000).catch(() => null);
          const contract = contractResp?.result as { verificationChecks?: Array<{ kind: string }> } | undefined;
          sawContract = Boolean(contract?.verificationChecks?.length);
          const approve = await sendRPC("goal.approveContract", { sessionId }, 60_000);
          if (!approve.error) approved = true;
        } else if (raw === "setting_up" && autoReplies < 3) {
          // If the model asked a clarification question despite the explicit
          // objective, or burned its contract-repair budget on a format quirk
          // (setupAwaitingUser), auto-reply to unblock (bounded to 3 times).
          const messagesResp = await sendRPC("agent.getFullMessages", { sessionId, sessionPath }, 30_000).catch(() => null);
          const messages = (messagesResp?.result as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? [];
          const transcriptTail = messages.slice(-4).map((m) => JSON.stringify(m.content)).join("\n");
          const askedQuestion = /[？?]/.test(transcriptTail);
          const repairCapped = transcriptTail.includes("repair limit reached");
          if (askedQuestion || repairCapped) {
            autoReplies += 1;
            await sendRPC("agent.send", {
              sessionId,
              content: repairCapped
                ? "继续：校验路径一律用相对路径（如 index.html），重新起草并提交契约。"
                : "无需进一步确认，按目标描述直接起草并提交完整契约即可。",
            }, 30_000).catch(() => undefined);
          }
        }
      }

      const finalResp = await sendRPC("goal.getStatus", { sessionId }, 30_000);
      const finalStatus = (finalResp.result ?? {}) as GoalStatus;

      // 1. lifecycle reached completion through a model-drafted contract
      expect(finalStatus.rawStatus).toBe("completed");
      expect(sawContract).toBe(true);
      expect(approved).toBe(true);

      // 2. the model actually delivered and ran its approved checks
      const messagesResp = await sendRPC("agent.getFullMessages", { sessionId, sessionPath }, 30_000);
      const messages = (messagesResp.result as { messages?: Array<{ role: string; content: unknown }> })?.messages ?? [];
      const transcript = messages.map((m) => JSON.stringify(m.content)).join("\n");
      expect(transcript).toContain("pi_goal_run_check");
      expect(transcript).toContain("pi_goal_record_evidence");

      // 3. deliverables exist on disk
      const htmlResp = await sendRPC("file.readFile", { path: join(projectDir, "index.html") }, 15_000).catch(() => null);
      const readmeResp = await sendRPC("file.readFile", { path: join(projectDir, "README.md") }, 15_000).catch(() => null);
      expect(String((htmlResp?.result as { content?: string })?.content ?? "")).toContain("25:00");
      expect(String((readmeResp?.result as { content?: string })?.content ?? "")).toContain("倒计时");
    },
    20 * 60_000,
  );
});
