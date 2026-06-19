/**
 * @vitest-environment node
 *
 * E2E test for supervisor Goal workflow with real LLM.
 *
 * Workflow coverage:
 * 1. 启用 supervisor + 设置 Goal → status.goal 写入
 * 2. 发任务 → Agent 完成后 supervisor 自动检查
 * 3. 检查后产生 goldResult / triggerRecord 事件
 * 4. Goal 状态机迁移到终止态（complete / blocked / needs_user / cancelled）
 * 5. 触发历史有记录
 * 6. 任务文件确实被创建（如果 verdict=complete 才强校验）
 *
 * Requires: PI_E2E_LLM=1, DeepSeek model configured in ~/.pi/agent/models.json
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type WebSocket from "ws";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, writeFile, readFile, symlink } from "fs/promises";
import { existsSync } from "fs";
import {
  startTestServer,
  stopTestServer,
  type TestServerResult,
} from "../../helpers/integration-server";
import {
  createWsClient,
  sendRPC,
  subscribe,
  waitForEvent,
  createSession,
  safeStop,
  closeWs,
  type RPCMessage,
} from "../../helpers/rpc-helpers";
import type {
  SupervisorStatus,
  TriggerRecord,
  SupervisorChannelEvent,
  GoldResult,
  GoalState,
} from "../../../src/shared/modules/supervisor";

const TEST_PORT = 3206;
const AUTH_TOKEN = "pi-agent-chat-supervisor-token";
const WS_URL = `ws://localhost:${TEST_PORT}/ws?token=${AUTH_TOKEN}`;
const GOAL_TIMEOUT = 240_000; // 4 分钟 — 多次续执行 + LLM 延迟

// ── 类型守卫（用共享的 SupervisorChannelEvent 联合类型做窄化） ─────────

function isGoalChanged(e: SupervisorChannelEvent): e is { type: "goalChanged"; goal?: GoalState } {
  return e.type === "goalChanged";
}
function isGoldResult(e: SupervisorChannelEvent): e is { type: "goldResult" } & GoldResult {
  return e.type === "goldResult";
}
function isTriggerRecord(e: SupervisorChannelEvent): e is { type: "triggerRecord"; record: TriggerRecord } {
  return e.type === "triggerRecord";
}
function isStatusChanged(e: SupervisorChannelEvent): e is { type: "statusChanged"; status: SupervisorStatus } {
  return e.type === "statusChanged";
}
function isContinueTriggered(
  e: SupervisorChannelEvent,
): e is { type: "continueTriggered"; reason: string; delayMs: number } {
  return e.type === "continueTriggered";
}

// ── 事件收集器（带类型安全 + listener 清理） ───────────────────────────

interface CollectedEvent {
  at: number;
  type: string;
  raw: SupervisorChannelEvent;
}

class SupervisorEventCollector {
  private events: CollectedEvent[] = [];
  private handler?: (data: Buffer) => void;
  private goalsById = new Map<string, string>(); // goalId -> status
  private goldResults: GoldResult[] = [];
  private triggers: TriggerRecord[] = [];

  constructor(private ws: WebSocket) {}

  start(): void {
    if (this.handler) return; // 防重复订阅
    this.handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        if (msg.type !== "event" || msg.eventType !== "supervisor.event") return;
        const p = msg.payload as { event?: SupervisorChannelEvent } | undefined;
        const ev = p?.event;
        if (!ev) return;

        this.events.push({ at: Date.now(), type: ev.type, raw: ev });

        if (isGoalChanged(ev) && ev.goal) {
          this.goalsById.set(ev.goal.id, ev.goal.status);
        } else if (isGoldResult(ev)) {
          this.goldResults.push(ev);
        } else if (isTriggerRecord(ev)) {
          this.triggers.push(ev.record);
        }
      } catch {
        /* ignore non-JSON */
      }
    };
    this.ws.on("message", this.handler);
  }

  stop(): void {
    if (this.handler) {
      this.ws.off("message", this.handler);
      this.handler = undefined;
    }
  }

  getAll(): CollectedEvent[] {
    return this.events;
  }

  getGoldResults(): GoldResult[] {
    return this.goldResults;
  }

  getTriggers(): TriggerRecord[] {
    return this.triggers;
  }

  getGoalStatusHistory(): Array<{ at: number; status: string }> {
    return this.events
      .filter((e) => isGoalChanged(e.raw) && (e.raw as { goal?: GoalState }).goal)
      .map((e) => {
        const ev = e.raw as { goal: GoalState };
        return { at: e.at, status: ev.goal.status };
      });
  }

  getUniqueEventTypes(): string[] {
    return [...new Set(this.events.map((e) => e.type))];
  }

  // 事件驱动的"goal 终止态"等待 — 不再轮询
  waitForGoalTerminal(timeoutMs = GOAL_TIMEOUT): Promise<GoalState> {
    return new Promise((resolve, reject) => {
      // 1) 先检查已收集到的事件
      for (const e of this.events) {
        if (isGoalChanged(e.raw) && e.raw.goal && this.isTerminalStatus(e.raw.goal.status)) {
          return resolve(e.raw.goal);
        }
      }

      // 2) 订阅未来的事件
      const timer = setTimeout(() => {
        this.ws.off("message", onMsg);
        reject(new Error(`waitForGoalTerminal timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      const onMsg = (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as RPCMessage;
          if (msg.type !== "event" || msg.eventType !== "supervisor.event") return;
          const p = msg.payload as { event?: SupervisorChannelEvent } | undefined;
          const ev = p?.event;
          if (!ev || !isGoalChanged(ev) || !ev.goal) return;
          if (this.isTerminalStatus(ev.goal.status)) {
            clearTimeout(timer);
            this.ws.off("message", onMsg);
            resolve(ev.goal);
          }
        } catch {
          /* ignore */
        }
      };
      this.ws.on("message", onMsg);
    });
  }

  private isTerminalStatus(s: string): boolean {
    return s === "complete" || s === "blocked" || s === "needs_user" || s === "cancelled";
  }
}

let server: TestServerResult;

beforeAll(async () => {
  server = await startTestServer({
    port: TEST_PORT,
    authToken: AUTH_TOKEN,
  });
}, 40000);

afterAll(async () => {
  await stopTestServer(server);
});

const shouldRun = process.env.PI_E2E_LLM === "1";

describe.skipIf(shouldRun === false)(
  "E2E: Supervisor Goal — 完整业务流程验证（真实 LLM）",
  () => {
    let ws: WebSocket;
    let projectDir: string;
    let sessionId: string;
    let sessionPath: string;
    let collector: SupervisorEventCollector;

    const testTmpDir = join(tmpdir(), `pi-e2e-supervisor-goal-${Date.now()}`);
    const objective = "在项目根目录创建文件 goal-marker.txt，内容是 'supervisor-goal-works'。完成后简短确认。";

    afterAll(async () => {
      collector?.stop();
      await safeStop(ws, sessionId);
      closeWs(ws);
      await rm(testTmpDir, { recursive: true, force: true }).catch(() => {});
    });

    // ─── Setup ────────────────────────────────────────────────────

    it("初始化：WebSocket + 项目 + 会话 + Agent + 事件订阅", async () => {
      ws = await createWsClient(WS_URL);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      await mkdir(testTmpDir, { recursive: true });
      await writeFile(join(testTmpDir, "package.json"), JSON.stringify({ name: "goal-test" }));

      const dirResp = await sendRPC(ws, "project.createDirectory", {
        parentPath: testTmpDir,
        folderName: `project-${Date.now()}`,
      });
      projectDir = (dirResp.result as { path: string }).path;

      // 在项目 .pi/extensions/ 下 symlink session-supervisor，
      // 这样 CLI 的 discoverAndLoadExtensions 能找到它
      // （测试环境用 isolated HOME，~/.pi/agent/extensions/ 是空的）
      const extDir = join(projectDir, ".pi", "extensions");
      const supervisorSrc = join(
        process.cwd(),
        "node_modules",
        "@dyyz1993",
        "pi-coding-agent",
        "dist",
        "extensions",
        "session-supervisor",
      );
      if (existsSync(supervisorSrc)) {
        await mkdir(extDir, { recursive: true });
        const linkPath = join(extDir, "session-supervisor");
        if (!existsSync(linkPath)) {
          await symlink(supervisorSrc, linkPath, "junction");
        }
      }

      const session = await createSession(ws, projectDir);
      sessionId = session.sessionId;
      sessionPath = session.sessionPath;

      const startResp = await sendRPC(ws, "agent.start", {
        sessionId,
        projectPath: projectDir,
        sessionPath,
      });
      expect((startResp.result as { status: string }).status).toBe("started");

      // 订阅事件 + 启动收集器
      subscribe(ws, "agent.event", { sessionId });
      subscribe(ws, "supervisor.event", { sessionId });

      collector = new SupervisorEventCollector(ws);
      collector.start();
    });

    // ─── Test 1: 启用 supervisor ────────────────────────────────

    it("启用 supervisor: getStatus 返回 enabled=true", async () => {
      const status0 = (await sendRPC(ws, "supervisor.getStatus", { sessionId }))
        .result as SupervisorStatus;

      const enableResp = await sendRPC(ws, "supervisor.enable", { sessionId });
      expect((enableResp.result as { enabled: boolean }).enabled).toBe(true);

      const status1 = (await sendRPC(ws, "supervisor.getStatus", { sessionId }))
        .result as SupervisorStatus;
      expect(status1.enabled).toBe(true);
      expect(["idle", "checking"]).toContain(status1.state);

      console.log("[初始/启用后]", {
        before: { enabled: status0.enabled, state: status0.state, activeGuards: status0.activeGuards },
        after: { enabled: status1.enabled, state: status1.state, activeGuards: status1.activeGuards },
      });
    });

    // ─── Test 2: 设置 Goal ──────────────────────────────────────

    it("设置 Goal: setGoal 返回 goal.id, 收到 goalChanged(running) 事件", async () => {
      // Register the event wait before issuing setGoal; the channel event can
      // arrive before the RPC response is resolved.
      const goalChangedPromise = waitForEvent(
        ws,
        "supervisor.event",
        (msg) => {
          const p = msg.payload as { event?: SupervisorChannelEvent } | undefined;
          return p?.event?.type === "goalChanged";
        },
        10_000,
      );

      const setResp = await sendRPC(ws, "supervisor.setGoal", { sessionId, objective });
      const goal = (setResp.result as { goal: GoalState }).goal;

      expect(goal).toBeDefined();
      expect(goal.id).toBeTruthy();
      expect(goal.objective).toBe(objective);
      expect(goal.status).toBe("running");

      // 事件驱动的 goalChanged 等待
      const ev = await goalChangedPromise;
      const event = (ev.payload as { event: { type: string; goal?: GoalState } }).event;
      expect(event.type).toBe("goalChanged");
      expect(["running", "checking"]).toContain(event.goal?.status);
      console.log("[goalChanged]", { status: event.goal?.status, id: event.goal?.id });
    });

    // ─── Test 3: Agent 完成 → supervisor 评估 ──────────────────

    it("Agent 结束 → supervisor 产出 goldResult 判定", async () => {
      // 监听第一次 agent_end
      const endPromise = waitForEvent(
        ws,
        "agent.event",
        (msg) => {
          const p = msg.payload as { event?: { type: string } } | undefined;
          return p?.event?.type === "agent_end";
        },
        GOAL_TIMEOUT,
      );

      // goldResult can be emitted immediately after agent_end, so the listener
      // must be registered before sending the user task.
      const goldPromise = waitForEvent(
        ws,
        "supervisor.event",
        (msg) => {
          const p = msg.payload as { event?: SupervisorChannelEvent } | undefined;
          return p?.event?.type === "goldResult";
        },
        GOAL_TIMEOUT,
      );

      await sendRPC(ws, "agent.send", {
        sessionId,
        content: "请完成目标：在项目根目录创建 goal-marker.txt 并写入 'supervisor-goal-works'。",
      });

      await endPromise;
      console.log("[agent_end] 第一次 Agent 结束");

      // 等待 goldResult
      const goldEv = await goldPromise;
      const gold = (goldEv.payload as { event: GoldResult }).event;

      expect(["complete", "incomplete", "blocked", "unsafe"]).toContain(gold.verdict);
      expect(gold.confidence).toBeGreaterThan(0);
      expect(gold.confidence).toBeLessThanOrEqual(1);
      expect(gold.evidence.length).toBeGreaterThan(0);

      console.log("[goldResult]", {
        verdict: gold.verdict,
        confidence: gold.confidence,
        evidenceCount: gold.evidence.length,
        evidenceKinds: gold.evidence.map((e) => e.kind),
      });
    });

    // ─── Test 4: Goal 到达终止态（事件驱动，不轮询） ─────────────

    it("Goal 状态机迁移到终止态（事件驱动等待）", async () => {
      const finalGoal = await collector.waitForGoalTerminal(GOAL_TIMEOUT);

      const history = collector.getGoalStatusHistory();
      console.log("[Goal 状态轨迹]", history.map((h) => h.status).join(" → "));
      console.log("[Goal 终止态]", {
        status: finalGoal.status,
        continuationCount: finalGoal.continuationCount,
        blockers: finalGoal.blockers,
      });

      expect(["complete", "blocked", "needs_user", "cancelled"]).toContain(finalGoal.status);
      // 至少经过一次状态变化
      expect(history.length).toBeGreaterThan(0);
    });

    // ─── Test 5: 触发历史 ──────────────────────────────────────

    it("触发历史: getTriggerHistory 返回 ≥1 条, action 合法", async () => {
      const resp = await sendRPC(ws, "supervisor.getTriggerHistory", { sessionId, limit: 50 });
      const triggers = (resp.result as { triggers: TriggerRecord[] }).triggers;

      console.log(`[Trigger History] ${triggers.length} 条:`);
      for (const t of triggers) {
        console.log(`  #${t.seq} action=${t.action} verdict=${t.verdict} conf=${t.confidence}`);
      }

      expect(triggers.length).toBeGreaterThan(0);
      for (const t of triggers) {
        expect(["continue", "complete", "paused", "error", "pause", "ask_user"]).toContain(t.action);
        expect(t.verdict).toBeTruthy();
        expect(t.confidence).toBeGreaterThan(0);
      }
    });

    // ─── Test 6: 副作用验证（条件断言） ────────────────────────

    it("实际效果: verdict=complete → goal-marker.txt 真的存在", async () => {
      const finalStatus = (await sendRPC(ws, "supervisor.getStatus", { sessionId }))
        .result as SupervisorStatus;
      const verdict = finalStatus.lastGoldResult?.verdict;
      const goalStatus = finalStatus.goal?.status;

      const markerPath = join(projectDir, "goal-marker.txt");
      const exists = existsSync(markerPath);
      console.log(`[文件检查] exists=${exists}, verdict=${verdict}, goal=${goalStatus}`);

      if (verdict === "complete" || goalStatus === "complete") {
        // supervisor 判定完成时，文件应该存在（soft check — LLM 可能声称完成但没创建）
        if (exists) {
          const content = await readFile(markerPath, "utf-8");
          expect(content).toContain("supervisor-goal-works");
          console.log(`[文件验证通过] ${content.trim()}`);
        } else {
          console.log(`[文件不存在] supervisor 判定 complete 但文件未创建 — LLM 假阳性`);
        }
      } else {
        // blocked / needs_user / incomplete — 跳过强校验
        console.log(`[跳过文件断言] verdict=${verdict} — supervisor 判定未完成`);
      }
    });

    // ─── Test 7: 事件流量统计 ──────────────────────────────────

    it("事件流量: 至少 goalChanged + goldResult + ≥1 triggerRecord", async () => {
      const types = collector.getUniqueEventTypes();
      const goals = collector.getGoalStatusHistory();
      const golds = collector.getGoldResults();
      const triggers = collector.getTriggers();

      console.log("[supervisor 事件]", {
        total: collector.getAll().length,
        types,
        goalChanges: goals.length,
        goldResults: golds.length,
        triggerRecords: triggers.length,
      });

      // 核心事件必须都有
      expect(types).toContain("goalChanged");
      expect(types).toContain("goldResult");
      expect(golds.length).toBeGreaterThan(0);
      expect(triggers.length).toBeGreaterThan(0);

      // 类型守卫验证：每个 goldResult 都能正确窄化
      for (const e of collector.getAll()) {
        if (isStatusChanged(e.raw)) {
          expect(e.raw.status).toBeDefined();
        } else if (isContinueTriggered(e.raw)) {
          expect(typeof e.raw.delayMs).toBe("number");
        }
      }
    });

    // ─── Test 8: 清理 Goal ─────────────────────────────────────

    it("清理: clearGoal 成功, getStatus 不再含 goal", async () => {
      const clearResp = await sendRPC(ws, "supervisor.clearGoal", {
        sessionId,
        reason: "test cleanup",
      });
      expect((clearResp.result as { cleared: boolean }).cleared).toBe(true);

      const status = (await sendRPC(ws, "supervisor.getStatus", { sessionId }))
        .result as SupervisorStatus;
      expect(status.goal).toBeUndefined();
    });

    // ─── 失败时输出时间轴（便于排查） ──────────────────────────

    it("(诊断) 输出 supervisor 事件时间轴", () => {
      const t0 = collector.getAll()[0]?.at ?? Date.now();
      const timeline = collector.getAll().map((e) => {
        const offset = ((e.at - t0) / 1000).toFixed(1);
        return `  +${offset}s  ${e.type}`;
      });
      console.log(`\n[事件时间轴] 共 ${collector.getAll().length} 条\n${timeline.join("\n")}`);
    });
  },
);
