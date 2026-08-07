/**
 * RPC driver for E2E tests. Wraps the pi-agent-chat WebSocket RPC protocol
 * and exposes high-level helpers for the goal lifecycle (startSetup,
 * submitContract, approveContract, clearGoal) plus session management.
 *
 * Used by L2 (real RPC) and L4 (LLM) layers. L1/L3 use mock-rpc.ts instead.
 */

import { WebSocket } from "ws";
import { E2E_AUTH_TOKEN } from "./e2e-project";

export interface GoalVendorStatus {
  enabled: boolean;
  state: "idle" | "setup" | "running" | "checking" | "paused" | "blocked" | "disabled";
  rawStatus: string;
  rawPhase: string;
  continuationSequence: number;
  turnCount: number;
  objective?: string;
  goalId?: string;
  generation?: number;
}

export interface SessionCreateResult {
  sessionId: string;
  sessionPath: string;
}

export interface GoalStartResult {
  started: boolean;
  goalId?: string;
  error?: string;
}

export interface GoalSubmitResult {
  submitted: boolean;
  goalId?: string;
  status?: string;
  error?: string;
}

export interface GoalApproveResult {
  approved: boolean;
  error?: string;
}

export interface GoalClearResult {
  cleared: boolean;
}

interface RpcResponse<T> {
  id?: string;
  error?: { message?: string };
  result?: T;
}

export class RpcDriver {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly url: string;

  constructor(
    host: string = process.env.E2E_HOST ?? "127.0.0.1",
    port: string = process.env.E2E_API_PORT ?? "3100",
    token: string = E2E_AUTH_TOKEN,
  ) {
    this.url = `ws://${host}:${port}/ws?token=${encodeURIComponent(token)}`;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.ws = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error("ws connect timeout")), 3000);
      ws.once("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as RpcResponse<unknown>;
      if (!msg.id || !this.pending.has(msg.id)) return;
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message ?? "rpc error"));
      } else {
        resolve(msg.result);
      }
    } catch {
      // ignore non-JSON
    }
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    await this.connect();
    const id = String(this.nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws!.send(JSON.stringify({ type: "request", id, method, params }));
    });
  }

  async close(): Promise<void> {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.close();
    });
  }

  // === high-level helpers ===

  async createSession(projectPath: string, projectName = "e2e-test"): Promise<SessionCreateResult> {
    return this.call<SessionCreateResult>("session.create", { projectPath, projectName, title: projectName });
  }

  async startAgent(sessionId: string, projectPath: string, sessionPath: string): Promise<{ status: string }> {
    return this.call<{ status: string }>("agent.start", { sessionId, projectPath, sessionPath });
  }

  async getGoalStatus(sessionId: string): Promise<GoalVendorStatus> {
    return this.call<GoalVendorStatus>("goal.getStatus", { sessionId });
  }

  async startSetup(sessionId: string, objective: string): Promise<GoalStartResult> {
    return this.call<GoalStartResult>("goal.startSetup", { sessionId, objective });
  }

  async submitContract(sessionId: string, contract: unknown): Promise<GoalSubmitResult> {
    return this.call<GoalSubmitResult>("goal.submitContract", { sessionId, contract });
  }

  async approveContract(sessionId: string): Promise<GoalApproveResult> {
    return this.call<GoalApproveResult>("goal.approveContract", { sessionId });
  }

  async clearGoal(sessionId: string): Promise<GoalClearResult> {
    return this.call<GoalClearResult>("goal.clearGoal", { sessionId });
  }

  async getMessages(sessionId: string, limit = 50): Promise<unknown[]> {
    const r = await this.call<{ messages?: unknown[] } | unknown[]>('agent.getFullMessages', { sessionId, limit });
    return Array.isArray(r) ? r : (r?.messages ?? []);
  }

  async scanSessions(projectPath: string): Promise<{ sessions: unknown[] }> {
    return this.call<{ sessions: unknown[] }>("project.scanSessions", { projectPath });
  }

  /**
   * Drive the full goal lifecycle for a session: startSetup → submitContract
   * → approveContract. Returns the final goal status. Useful for L2 tests
   * that need the goal to be running without going through the UI.
   */
  async driveGoalLifecycle(
    sessionId: string,
    objective: string,
    contract: unknown,
  ): Promise<{ status: GoalVendorStatus; started: GoalStartResult; submitted: GoalSubmitResult; approved: GoalApproveResult }> {
    const started = await this.startSetup(sessionId, objective);
    if (!started.started) throw new Error(`startSetup failed: ${started.error}`);
    const submitted = await this.submitContract(sessionId, contract);
    if (!submitted.submitted) throw new Error(`submitContract failed: ${submitted.error}`);
    const approved = await this.approveContract(sessionId);
    if (!approved.approved) throw new Error(`approveContract failed: ${approved.error}`);
    const status = await this.getGoalStatus(sessionId);
    return { status, started, submitted, approved };
  }
}
