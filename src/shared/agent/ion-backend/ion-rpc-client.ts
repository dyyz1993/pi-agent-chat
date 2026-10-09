/**
 * IonRpcClient —— RpcClientAPI 的 ion 后端实现（Phase 1 核心闭环）。
 *
 * 范围（docs/plans/2026-09-25-ion-backend-adoption-plan.md Phase 1）：
 *  - 生命周期：start（ensureHost + 幂等 create_session + 订阅泵）/ stop（只断客户端）；
 *  - 消息：prompt/steer/followUp/abort、getFullMessages（host 直读 + flatten）、
 *    分页（head/tail 游标）、getLastAssistantText；
 *  - 状态：getState/getTree/getTreeWithLeaf（entries+leafId 适配）、模型三件套、
 *    thinking、queue、compact、权限、bash、reload、session 命名；
 *  - 事件：subscribe 泵 → event-map 归一化为 AgentEvent。
 *
 * 未实现的方法统一抛 `ion backend: <m> not implemented`（能力缺口显式暴露，
 * 后续按 contract-matrix.md 处置表逐个补，不静默返回假数据）。
 *
 * 会话身份映射：app sessionPath 的文件名 stem ↔ ion session_id（幂等复活，
 * 同一 stem 重启后 create_session 原地恢复，历史由 ion 从自己的 JSONL 读回）。
 */

import net, { type Socket } from "node:net";
import { basename } from "node:path";
import type { AgentEvent, ThinkingLevel } from "@dyyz1993/pi-agent-core";
import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";
import { IonSocketTransport } from "./ion-socket-transport";
import { IonSubscribePump } from "./ion-subscribe-pump";
import { flattenIonMessages } from "./ion-flatten";
import { lookupIonChannel } from "./channel-map";
import { ionCapabilities } from "./capability";
import { createLogger } from "../../lib/logger";

/** channel.invoke 的历史载荷形态：{__call: method, ...params}（fork channel-manager 约定） */
function asCallPayload(data: unknown): Record<string, unknown> & { __call?: unknown } {
  return data && typeof data === "object"
    ? (data as Record<string, unknown> & { __call?: unknown })
    : {};
}

const log = createLogger("ion-client");

export interface IonRpcClientOptions {
  socketPath?: string;
  cwd: string;
  /** ion session_id；缺省从 app sessionPath 文件名派生 */
  sessionId?: string;
  sessionPath?: string;
  autoSpawnHost?: boolean;
}

interface IonTreeResult {
  currentLeaf?: string;
  pathToLeaf?: string[];
  tree?: { nodes?: Array<{ id?: string; parentId?: string; type?: string; brief?: string }> };
  nodes?: Array<{ id?: string; parentId?: string; type?: string; brief?: string }>;
  branches?: unknown[];
}

interface IonStateResult {
  model?: string;
  provider?: string;
  is_running?: boolean;
  message_count?: number;
  thinkingLevel?: string;
  sessionId?: string;
}

function notImplemented(method: string): never {
  throw new Error(
    `ion backend: ${method} not implemented (see docs/plans/ion-backend/contract-matrix.md)`,
  );
}

function toTreeEntries(
  tree: IonTreeResult | undefined,
): Array<{ id: string; parentId: string | null; type: string; label?: string }> {
  const nodes = tree?.tree?.nodes ?? tree?.nodes ?? [];
  return nodes
    .filter(
      (node): node is { id: string; parentId?: string; type?: string; brief?: string } =>
        typeof node.id === "string",
    )
    .map((node) => ({
      id: node.id,
      parentId: typeof node.parentId === "string" ? node.parentId : null,
      type: node.type ?? "message",
      label: node.brief,
    }));
}

function leafOf(tree: IonTreeResult | undefined): string | null {
  return typeof tree?.currentLeaf === "string" ? tree.currentLeaf : null;
}

export class IonRpcClient {
  private transport: IonSocketTransport;
  private pump: IonSubscribePump | null = null;
  private eventListeners = new Set<(event: AgentEvent) => void>();
  private sessionId: string;
  private sessionIdOverride: string | undefined;
  private cwd: string;
  private autoSpawnHost: boolean;
  private started = false;
  /** 事件流推导的 streaming 态（agent_start/end）—— ion 的 is_running 在
   * auto-title/复活路径上实测不可信（浏览器 E2E 踩坑：卡 true 导致前端误判
   * streaming 走 steer，而 ion 空闲 steer 只进队列、消息被静默丢弃）。 */
  private eventStreaming = false;
  /** 最近一次 agent_end 时间（毫秒）——prompt 前置 settle 用（ion 双 turn 竞态防护） */
  private lastAgentEndAt = 0;
  /** UI 专用长连接（subscribe{ui:true}；ui_respond 必须同连接发送 —— 实测 G4 协议） */
  private uiSocket: Socket | null = null;
  private uiRespondSeq = 0;

  constructor(options: IonRpcClientOptions) {
    this.transport = new IonSocketTransport(options.socketPath);
    this.cwd = options.cwd;
    this.autoSpawnHost = options.autoSpawnHost ?? true;
    this.sessionIdOverride = options.sessionId;
    this.sessionId =
      options.sessionId ??
      (options.sessionPath ? basename(options.sessionPath).replace(/\.jsonl$/, "") : "");
  }

  get ionSessionId(): string {
    return this.sessionId;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.transport.ensureHost(this.autoSpawnHost);

    if (!this.sessionId) {
      const created = await this.transport.managerCall<{ session_id?: string }>("create_session", {
        agent: "developer",
        cwd: this.cwd,
      });
      this.sessionId = created?.session_id ?? this.sessionIdOverride ?? "";
    } else {
      // 幂等复活：已存在的 session_id 原地恢复（历史从 ion JSONL 读回）
      await this.transport.managerCall("create_session", {
        agent: "developer",
        session_id: this.sessionId,
        cwd: this.cwd,
      });
    }
    if (!this.sessionId) throw new Error("ion backend: failed to obtain session id");

    // 自动标题 turn 结算等待：create_session 会立刻触发 title 生成 turn，实测
    // 在其收尾窗口（agent_end 后 ~100ms 内）发 prompt 会让 worker 挂死
    // （agent_start 后零 text_delta、零 agent_end → phantom-running）。
    // 等 is_running 归位再返回，关闭竞态窗口；超时 3s 放行（不阻塞启动）。
    const settleDeadline = Date.now() + 3000;
    while (Date.now() < settleDeadline) {
      try {
        const st = await this.transport.sessionCall<{ is_running?: boolean }>(
          this.sessionId,
          "get_state",
          {},
        );
        if (st?.is_running !== true) break;
      } catch {
        // get_state 被拒（罕见）—— 继续等
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    this.pump = new IonSubscribePump({
      socketPath: this.transport.path,
      sessionId: this.sessionId,
      onEvent: (event) => {
        const type = (event as { type?: string }).type;
        if (type === "agent_start") this.eventStreaming = true;
        else if (type === "agent_end") {
          this.eventStreaming = false;
          this.lastAgentEndAt = Date.now();
        }
        for (const listener of this.eventListeners) {
          try {
            listener(event as AgentEvent);
          } catch (err) {
            log.warn("event listener error", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      },
      onReconnect: (info) => log.info("subscribe reconnect", { session: this.sessionId, ...info }),
    });
    this.pump.start();
    this.ensureUiConnection();
    this.started = true;
  }

  async stop(): Promise<void> {
    this.pump?.stop();
    this.pump = null;
    this.uiSocket?.destroy();
    this.uiSocket = null;
    this.transport.stop();
    this.started = false;
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getStderr(): string {
    return "";
  }

  // ── 消息/中断 ──

  async prompt(message: string): Promise<void> {
    await this.settleBeforePrompt();
    await this.transport.sessionCall(this.sessionId, "prompt", { text: message });
  }

  /**
   * ion 双 turn 竞态防护（实测复现）：上一 turn 的 agent_end 后 ~1-3s 内发下一个
   * prompt，worker 会半执行后永久锁死（text_delta 已发、agent_end 永不发出、
   * is_running 卡 true、worker 级 RPC 全拒）。prompt 前若刚结束一轮且已空闲，
   * 等 is_running 归位 + 渡过竞态窗口（共 ≤3s，超时放行不阻塞）。
   */
  private async settleBeforePrompt(): Promise<void> {
    if (this.eventStreaming) return;
    const sinceEnd = Date.now() - this.lastAgentEndAt;
    const graceMs = 2500;
    if (sinceEnd < 0) return;
    if (sinceEnd < graceMs) {
      await new Promise((r) => setTimeout(r, graceMs - sinceEnd));
    }
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        const st = await this.transport.sessionCall<{ is_running?: boolean }>(
          this.sessionId,
          "get_state",
          {},
        );
        if (st?.is_running !== true) break;
      } catch {
        break; // get_state 被拒（罕见）—— 放行，由 ion 排队兜底
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** 空闲判定：只信事件流（agent_start/end 推导）。ion 的 is_running 实测在
   * auto-title/复活路径卡 true，不可作为投递依据；误判为空闲也安全 ——
   * ion 的 prompt 在真忙时会排队（"忙时默认排队"），不会打断进行中的 turn。 */
  private isEventuallyBusy(): boolean {
    return this.eventStreaming;
  }

  /**
   * worker 级 RPC 自愈包装：
   *  - "worker dropped response channel"（worker 崩溃被重拉）→ 幂等复活会话再试；
   *  - "agent is running" 但事件流说空闲（假 running / 崩溃残留）→ 先等后复活；
   *  - 复活时若前端还卡 streaming，合成 agent_end 解锁（真实 agent_end 已随
   *    worker 死亡永久丢失 —— 实测：真实编码任务中 worker stdout closed 崩溃）。
   */
  private async resilientCall<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.transport.sessionCall<T>(
          this.sessionId,
          method,
          params ?? {},
          timeoutMs ? { timeoutMs } : undefined,
        );
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("worker dropped")) {
          await this.reviveAfterWorkerDeath();
          continue;
        }
        if (msg.includes("agent is running") && !this.eventStreaming) {
          if (attempt >= 1) {
            await this.reviveAfterWorkerDeath();
            continue;
          }
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  private async reviveAfterWorkerDeath(): Promise<void> {
    const wasStreaming = this.eventStreaming;
    log.warn("[ion] worker dead/stuck, reviving session", {
      sessionId: this.sessionId,
      wasStreaming,
    });
    await this.transport.managerCall("create_session", {
      agent: "developer",
      session_id: this.sessionId,
      cwd: this.cwd,
    });
    this.eventStreaming = false;
    this.cachedExtensionNames = null;
    this.readCache.clear();
    if (wasStreaming) {
      const synthetic = { type: "agent_end", messages: [] };
      for (const listener of this.eventListeners) {
        try {
          listener(synthetic as unknown as AgentEvent);
        } catch {
          // 监听器异常不阻断
        }
      }
    }
  }

  /** 慢变读：失败时出缓存（tier/models/stats 会话内几乎不变，缓存优于报错） */
  private async cachedRead<T>(key: string, fetch: () => Promise<T>): Promise<T> {
    try {
      const value = await fetch();
      this.readCache.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      const cached = this.readCache.get(key);
      if (cached) {
        log.warn("[ion] read failed, serving cached", {
          key,
          err: err instanceof Error ? err.message : String(err),
        });
        return cached.value as T;
      }
      throw err;
    }
  }

  async steer(message: string): Promise<void> {
    // ion 的 steer 只进 steering 队列、等下一轮 turn 开始才消费 —— 空闲时 steer
    // 会被静默丢弃（实测：steer 后 message_count 不变）。pi 语义里空闲 steer =
    // 直接投递，这里对齐：空闲转 prompt。
    await this.settleBeforePrompt();
    if (this.isEventuallyBusy()) {
      await this.transport.sessionCall(this.sessionId, "steer", { text: message });
      return;
    }
    await this.transport.sessionCall(this.sessionId, "prompt", { text: message });
  }

  async followUp(message: string): Promise<void> {
    if (this.isEventuallyBusy()) {
      await this.transport.sessionCall(this.sessionId, "follow_up", { text: message });
      return;
    }
    await this.transport.sessionCall(this.sessionId, "prompt", { text: message });
  }

  async abort(): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "abort", {});
  }

  async sendMessage(message: string): Promise<void> {
    await this.prompt(message);
  }

  async bash(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.transport.sessionCall<{
      stdout?: string;
      stderr?: string;
      exitCode?: number;
    }>(this.sessionId, "bash", { command });
    return {
      stdout: result?.stdout ?? "",
      stderr: result?.stderr ?? "",
      exitCode: result?.exitCode ?? -1,
    };
  }

  async abortBash(): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "abort_bash", {});
  }

  /**
   * UI 专用长连接：subscribe{ui:true}（不带 session）。
   * 实测协议（G4）：ui_respond 必须在与此订阅同一条连接上发送，跨连接被拒；
   * 连接上收到的 ui_event（带 request_id）映射为 extension_ui_request 事件外发。
   */
  private ensureUiConnection(): void {
    if (this.uiSocket && !this.uiSocket.destroyed) return;
    const socket = net.createConnection(this.transport.path);
    this.uiSocket = socket;
    let buffer = "";
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: "ui-sub", method: "subscribe", ui: true })}
`);
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let frame: Record<string, unknown>;
        try {
          frame = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        this.handleUiFrame(frame);
      }
    });
    socket.on("error", () => {
      socket.destroy();
      if (this.uiSocket === socket) this.uiSocket = null;
    });
  }

  private handleUiFrame(frame: Record<string, unknown>): void {
    // 响应行（subscribe ack / ui_respond 回包）：无需外发
    if (frame.success !== undefined || frame.type === "subscribed") return;
    const data = (frame.data ?? frame) as Record<string, unknown>;
    const requestId =
      (typeof frame.request_id === "string" && frame.request_id) ||
      (typeof data.request_id === "string" && data.request_id) ||
      null;
    if (!requestId) return;
    // ion ui_event → pi ExtensionUIRequestEvent（字段防御式读取；method 未知时按
    // confirm 走 interactive 分类，让审批卡可应答）
    const method = typeof data.method === "string" ? data.method : "confirm";
    const event = {
      type: "extension_ui_request",
      id: requestId,
      method,
      title: typeof data.title === "string" ? data.title : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
      options: Array.isArray(data.options) ? (data.options as string[]) : undefined,
    };
    for (const listener of this.eventListeners) {
      try {
        listener(event as unknown as AgentEvent);
      } catch {
        // 监听器异常不阻断
      }
    }
  }

  respondUI(requestId: string, response: Record<string, unknown>): void {
    this.ensureUiConnection();
    const socket = this.uiSocket;
    if (!socket || socket.destroyed) {
      log.warn("[respondUI] ui connection unavailable", { requestId });
      return;
    }
    const id = `ui-respond-${++this.uiRespondSeq}`;
    socket.write(
      `${JSON.stringify({ id, method: "ui_respond", params: { request_id: requestId, response } })}\n`,
    );
  }

  // ── 读取/分页 ──

  private async fetchMessages(params: Record<string, unknown>): Promise<{
    raw: unknown;
    hasMore: boolean;
    nextCursor: string | null;
  }> {
    const result = await this.transport.sessionCall<{
      messages?: unknown;
      hasMore?: boolean;
      nextCursor?: string | null;
    }>(this.sessionId, "get_session_messages", params);
    return {
      raw: result?.messages ?? [],
      hasMore: result?.hasMore === true,
      nextCursor: typeof result?.nextCursor === "string" ? result.nextCursor : null,
    };
  }

  private async fetchTree(): Promise<IonTreeResult | undefined> {
    // worker 级 RPC：ion "running" 期间会被拒（实测 is_running 有卡死路径，
    // title-turn + steer 转换 prompt 后不复位）。树/leaf 只是辅助数据，
    // 软失败返回 undefined，绝不拖垮消息读取（get_session_messages 是 host
    // 直读，永不被拒）。
    try {
      return await this.transport.sessionCall<IonTreeResult>(
        this.sessionId,
        "get_tree_with_leaf",
        {},
      );
    } catch {
      return undefined;
    }
  }

  async getFullMessages(): Promise<Record<string, unknown>> {
    const { raw } = await this.fetchMessages({});
    const tree = await this.fetchTree();
    return {
      messages: flattenIonMessages(raw),
      hasMore: false,
      totalCount: Array.isArray(raw) ? raw.length : 0,
      nextCursor: null,
      tree: { entries: toTreeEntries(tree), leafId: leafOf(tree) },
      customEntries: [],
      compactionEntries: [],
    };
  }

  async getMessageNavPage(options?: {
    from?: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (options?.limit) params.limit = options.limit;
    if (options?.from === "head" || options?.from === "start") params.from = "head";
    const { raw, hasMore, nextCursor } = await this.fetchMessages(params);
    return {
      messages: flattenIonMessages(raw),
      hasMore,
      totalCount: Array.isArray(raw) ? raw.length : 0,
      nextCursor,
    };
  }

  async getFullMessagesAround(options: {
    entryId?: string;
    targetEntryId?: string;
    before?: number;
    after?: number;
  }): Promise<Record<string, unknown>> {
    // ion 游标是 head/tail 语义，无 entryId 定位；用 tail 近似（app 的 around 主要用于跳转最新上下文）
    void options;
    const { raw, hasMore } = await this.fetchMessages({});
    return {
      messages: flattenIonMessages(raw),
      hasMoreBefore: false,
      hasMoreAfter: hasMore,
      beforeCursor: null,
      afterCursor: null,
      targetFound: true,
      totalCount: Array.isArray(raw) ? raw.length : 0,
    };
  }

  async getTree(): Promise<Record<string, unknown>> {
    const tree = await this.fetchTree();
    return { entries: toTreeEntries(tree), leafId: leafOf(tree) };
  }

  async getTreeWithLeaf(): Promise<Record<string, unknown>> {
    const tree = await this.fetchTree();
    return { entries: toTreeEntries(tree), leafId: leafOf(tree) };
  }

  async getLastAssistantText(): Promise<string | null> {
    const text = await this.transport.sessionCall<string>(
      this.sessionId,
      "get_last_assistant_text",
      {},
    );
    return typeof text === "string" ? text : null;
  }

  // ── 状态/模型/thinking/queue/compact/权限 ──

  async getState(): Promise<Record<string, unknown>> {
    const state = await this.resilientCall<IonStateResult>("get_state", {});
    // get_state 的 model 只有 {model, provider}，没有 reasoning/contextWindow 等
    // 能力位 —— 用同一后端的 available_models 补全（ Thinking 行依赖 reasoning）
    let enriched: Record<string, unknown> | undefined;
    if (state?.model) {
      try {
        const avail = await this.getAvailableModels();
        enriched = avail.find(
          (m) => m.id === state.model && (!m.provider || m.provider === state.provider),
        ) as Record<string, unknown> | undefined;
      } catch {
        // available_models 不可达时保持 get_state 原样
      }
    }
    return {
      thinkingLevel: (state?.thinkingLevel ?? "off") as ThinkingLevel,
      isStreaming: this.eventStreaming || state?.is_running === true,
      isCompacting: false,
      steeringMode: "all" as const,
      followUpMode: "all" as const,
      permissionMode: "",
      sessionId: state?.sessionId ?? this.sessionId,
      messageCount: state?.message_count ?? 0,
      pendingMessageCount: 0,
      autoCompactionEnabled: true,
      model: state
        ? {
            id: state.model ?? "",
            name: state.model ?? "",
            provider: state.provider ?? "",
            api: enriched?.api ?? "",
            cost: enriched?.cost ?? { input: 0, output: 0 },
            contextWindow: enriched?.contextWindow ?? 0,
            maxTokens: enriched?.maxTokens ?? 0,
            reasoning: enriched?.reasoning ?? false,
          }
        : undefined,
    };
  }

  async getAvailableModels(): Promise<Array<Record<string, unknown>>> {
    const models = await this.cachedRead("available_models", () =>
      this.resilientCall<Array<Record<string, unknown>>>("get_available_models", {}),
    );
    return (models ?? []).map((m) => ({
      id: m.id ?? "",
      name: m.name ?? m.id ?? "",
      provider: m.provider ?? "",
      api: m.api ?? "",
      contextWindow: m.contextWindow ?? 0,
      maxTokens: m.maxTokens ?? 0,
      cost: m.cost ?? { input: 0, output: 0 },
      reasoning: m.reasoning ?? false,
      input: m.input ?? ["text"],
    }));
  }

  async setModel(provider: string, modelId: string): Promise<Record<string, unknown>> {
    // ion 回 get_state 形状（{model, provider}）；pi 前端（tier 切换/模型标签）
    // 要 {provider, id} —— 形状不符曾导致 tier 切换静默无反馈
    const result = await this.resilientCall<{ model?: string; provider?: string }>("set_model", {
      provider,
      modelId,
    });
    return {
      provider: typeof result?.provider === "string" ? result.provider : provider,
      id: typeof result?.model === "string" ? result.model : modelId,
    };
  }

  async cycleModel(): Promise<Record<string, unknown> | null> {
    return this.transport.sessionCall(this.sessionId, "cycle_model", {});
  }

  async getTierModels(): Promise<Record<string, string>> {
    return this.cachedRead("tier_models", () =>
      this.resilientCall<Record<string, string>>("get_tier_models", {}),
    );
  }

  async setTierModels(models: { fast?: string; pro?: string; max?: string }): Promise<void> {
    // ion 按单 tier 设置（contract-matrix §1.5），pi 是整 map —— adapter 拆分
    for (const [tier, value] of Object.entries(models)) {
      if (value)
        await this.transport.sessionCall(this.sessionId, "set_tier_models", { tier, model: value });
    }
    // tier_models 读缓存无 TTL；不在这里失效的话，保存后 switchTier 仍会读到旧表
    this.readCache.delete("tier_models");
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "set_thinking_level", { level });
  }

  async cycleThinkingLevel(): Promise<Record<string, unknown> | null> {
    return this.transport.sessionCall(this.sessionId, "cycle_thinking_level", {});
  }

  async getQueue(): Promise<Record<string, unknown>> {
    const queue = await this.transport.sessionCall<{
      steering?: unknown[];
      steeringCount?: number;
      followUp?: unknown[];
      followUpCount?: number;
    }>(this.sessionId, "get_queue", {});
    return {
      steering: { messages: queue?.steering ?? [] },
      followUp: { messages: queue?.followUp ?? [] },
    };
  }

  async clearQueue(): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "clear_queue", {});
  }

  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "set_steering_mode", { mode });
  }

  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "set_follow_up_mode", { mode });
  }

  async compact(): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "compact", {});
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "set_auto_compaction", { enabled });
  }

  async setPermissionMode(mode: string): Promise<{ mode: string }> {
    // ion 返回 {mode, success}（soft-error 时 {error}）；适配层原先丢返回值，
    // 操作层读 result.mode 直接 TypeError → 权限切换 500 且 UI 静默无反馈
    const result = await this.transport.sessionCall<{
      mode?: string;
      success?: boolean;
      error?: string;
    }>(this.sessionId, "set_permission_mode", { mode });
    if (result?.error) throw new Error(String(result.error));
    return { mode: result?.mode ?? mode };
  }

  async setSessionName(name: string): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "set_session_name", { name });
  }

  async getSessionStats(): Promise<Record<string, unknown>> {
    return this.cachedRead("session_stats", () =>
      this.resilientCall<Record<string, unknown>>("get_session_stats", {}),
    );
  }

  async getContextUsage(): Promise<Record<string, unknown>> {
    // 上下文用量每轮都变——不走 readCache（无 TTL，会一直命中首帧值）；
    // 调用点是 agent_end 后的权威刷新，频率低，直连即可
    const usage = await this.resilientCall<Record<string, unknown>>("get_context_usage", {});
    const estimatedTokens = Number(usage?.estimatedTokens ?? 0);
    return {
      // pi 消费方（TokenStatusBar/refreshAuthoritativeContextUsage）读 tokens
      inputTokens: estimatedTokens,
      tokens: estimatedTokens,
      contextWindow: Number(usage?.contextWindow ?? 0),
      usagePercent: usage?.usagePercent ?? 0,
      autoCompaction: usage?.autoCompaction ?? false,
    };
  }

  async reload(): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "reload", {});
    this.cachedExtensionNames = null; // 扩展集合可能已变，能力表重新探测
  }

  async setCwd(cwd: string): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "set_cwd", { cwd });
  }

  // ── 资源清单（对齐 pi 形状：数组，而非 ion 的 {count,xxx:[]}） ──

  async getCommands(): Promise<Array<Record<string, unknown>>> {
    return this.transport.sessionCall(this.sessionId, "get_commands", {});
  }

  async getSkills(): Promise<Array<Record<string, unknown>>> {
    const result = await this.transport.sessionCall<{ skills?: unknown }>(
      this.sessionId,
      "get_skills",
      {},
    );
    return Array.isArray(result?.skills) ? (result.skills as Array<Record<string, unknown>>) : [];
  }

  async getExtensions(): Promise<Array<Record<string, unknown>>> {
    // ion 条目只有 {name}；fork/前端消费者要 {path, resolvedPath, toolNames...}
    // （缺失 path 曾致前端 extension.path.split 抛错 —— 两个并发智能体独立复现）
    const result = await this.cachedRead("extensions", () =>
      this.resilientCall<{ extensions?: unknown }>("get_extensions", {}),
    );
    const raw = Array.isArray(result?.extensions)
      ? (result.extensions as Array<Record<string, unknown>>)
      : [];
    return raw.map((e) => {
      const name = typeof e.name === "string" ? e.name : "anonymous";
      return {
        path: name,
        resolvedPath: name,
        toolNames: Array.isArray(e.tools) ? (e.tools as string[]) : [],
        commandNames: [],
        channelNames: [],
        eventNames: [],
        permissionProviderNames: [],
        ...e,
      };
    });
  }

  /**
   * 壳模式能力发现：channel-map × 实际加载扩展 → 能力表（见 capability.ts）。
   * get_extensions 是 worker 级 RPC，"running" 窗口会被拒（实测重载后高发）——
   * 重试 + 会话内缓存（扩展集合会话内稳定；reload 时清缓存）。
   */
  private cachedExtensionNames: string[] | null = null;
  /** 慢变读缓存（tier/models/stats 等）：ion running 窗口拒读时出缓存，不让面板死掉 */
  private readCache = new Map<string, { at: number; value: unknown }>();

  async getChannelCapabilities(): Promise<Record<string, unknown>> {
    let names = this.cachedExtensionNames;
    if (!names) {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const extensions = await this.getExtensions();
          names = extensions.map((e) => (typeof e.name === "string" ? e.name : "")).filter(Boolean);
          this.cachedExtensionNames = names;
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      names ??= [];
    }
    return ionCapabilities(names) as unknown as Record<string, unknown>;
  }

  async getTools(): Promise<Array<Record<string, unknown>>> {
    const result = await this.transport.sessionCall<{ tools?: unknown }>(
      this.sessionId,
      "get_tools",
      {},
    );
    return Array.isArray(result?.tools) ? (result.tools as Array<Record<string, unknown>>) : [];
  }

  async getAllTools(): Promise<Array<Record<string, unknown>>> {
    // ion 无独立 all-tools 语义（get_all_tools 实测返回空），用 get_tools 兜底
    return this.getTools();
  }

  // ion get_agents 的返回形状随 worker 状态漂移：正常回裸数组；worker 未挂上时
  // host 层回 {session,status:"forwarded"} 包装对象——不归一的话上层
  // (agents ?? []).find 直接崩（"Failed to fetch agent detail"）。
  private normalizeAgents(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.agents)) return obj.agents as Array<Record<string, unknown>>;
    }
    return [];
  }

  async getAgentDetail(agentName?: string): Promise<Record<string, unknown> | null> {
    const agents = this.normalizeAgents(
      await this.transport.sessionCall(this.sessionId, "get_agents", {}),
    );
    const match = agents.find((a) => a.name === agentName) ?? agents[0];
    return match ?? null;
  }

  async getActiveTools(): Promise<Array<string>> {
    const result = await this.transport.sessionCall<{ tools?: unknown }>(
      this.sessionId,
      "get_active_tools",
      {},
    );
    return Array.isArray(result?.tools) ? (result.tools as string[]) : [];
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    await this.transport.sessionCall(this.sessionId, "set_active_tools", { tools: toolNames });
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "get_settings", {});
  }

  async getMcpServers(): Promise<Array<Record<string, unknown>>> {
    return this.transport.sessionCall(this.sessionId, "get_mcp_servers", {});
  }

  async getAgents(): Promise<Array<Record<string, unknown>>> {
    return this.normalizeAgents(await this.transport.sessionCall(this.sessionId, "get_agents", {}));
  }

  async getCurrentAgent(): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "get_current_agent", {});
  }

  // ── 树操作（参数适配） ──

  async navigateTree(targetId: string): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "navigate_tree", { targetId });
  }

  async previewRollback(targetId: string): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "rollback_preview", { targetId });
  }

  async deleteEntries(targetIds: string[]): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "delete_entries", { targetIds });
  }

  async summarizeEntries(targetIds: string[], summary: string): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "summarize_entries", { targetIds, summary });
  }

  async newSession(): Promise<Record<string, unknown>> {
    const created = await this.transport.sessionCall<{ sessionId?: string }>(
      this.sessionId,
      "new_session",
      {},
    );
    if (created?.sessionId) this.sessionId = created.sessionId;
    return created ?? {};
  }

  async clone(): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "clone", {});
  }

  async exportHtml(): Promise<{ path: string }> {
    return this.transport.sessionCall(this.sessionId, "export_html", {});
  }

  async getModifiedFiles(): Promise<Record<string, unknown>> {
    return this.transport.sessionCall(this.sessionId, "get_modified_files", {});
  }

  async send(command: Record<string, unknown>): Promise<{ data: unknown }> {
    // pi 原始协议用 `type` 字段携带命令名（如 switch_agent 操作层），ion 用 method
    const method =
      typeof command.method === "string"
        ? command.method
        : typeof command.type === "string"
          ? command.type
          : "prompt";
    const { method: _m, type: _t, ...params } = command;

    // tier 命令形状互不匹配（contract-matrix §1.5），必须在适配层归一：
    // - get：ion 返回裸 {fast,pro,max}，pi 操作层取 data.models —— 不包一层恒为
    //   空 map，switchTier 永远 "not configured"（chip 点击无高亮的根因）。
    // - set：pi 一次传 {models} 整包，ion 按单 tier 收 {tier,model} —— 不拆分
    //   的话 app 侧档位配置从未真正写进 ion。
    if (method === "get_tier_models") {
      const models = await this.getTierModels();
      return { data: { models } };
    }
    if (method === "set_tier_models") {
      const models = (params.models ?? {}) as Record<string, string>;
      await this.setTierModels(models);
      return { data: { ok: true } };
    }
    // get_agents：ion 回裸数组，pi 操作层取 data.agents —— 不包一层侧栏
    // Agent 下拉恒为空列表
    if (method === "get_agents") {
      const agents = await this.getAgents();
      return { data: { agents } };
    }

    const data = await this.transport.sessionCall(this.sessionId, method, params);
    return { data };
  }

  channel(name: string): {
    name: string;
    send: () => Promise<void>;
    onReceive: (handler: (data: unknown) => void) => unknown;
    invoke: (data: unknown, timeoutMs?: number) => Promise<unknown>;
    call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  } {
    // 声明式映射（channel-map.ts）；未映射方法显式抛错（缺口可见）。
    // onReceive 推送事件（todo/subagent 变更等）属 Phase 3 后续批次。
    const sessionId = this.sessionId;
    const transport = this.transport;
    const callChannel = (method: string, params: Record<string, unknown>, timeoutMs?: number) =>
      callIonChannelTarget(transport, sessionId, name, method, params, timeoutMs);
    return {
      name,
      send: async () => {},
      onReceive: () => () => {},
      invoke: (data: unknown) => {
        const { __call: method, ...params } = asCallPayload(data);
        return callChannel(String(method ?? ""), params);
      },
      call: (method: string, params: Record<string, unknown>, timeoutMs?: number) =>
        callChannel(method, params, timeoutMs),
    };
  }

  // ── Phase 1 显式未实现（调用即抛，缺口可见） ──

  async fork(): Promise<never> {
    notImplemented("fork（参数 turnId:number 适配未做）");
  }
  async getForkMessages(): Promise<never> {
    notImplemented("getForkMessages");
  }
  // 箭头函数属性：history-operations 会把此方法解构后裸调用（this 会丢）
  getFileDiff = async (options: {
    filePath: string;
    fromHash?: string;
    toHash?: string;
  }): Promise<Record<string, unknown> | null> => {
    // ion: get_file_diff {filePath} → {diff, hasContent, path}；diff 为 null 时 pi 语义返回 null
    const result = await this.transport.sessionCall<{
      diff?: Record<string, unknown> | null;
      hasContent?: boolean;
      path?: string;
    }>(this.sessionId, "get_file_diff", { filePath: options.filePath });
    if (!result?.diff) return null;
    return { path: result.path ?? options.filePath, ...result.diff };
  };
  async getBatchDiffs(options?: {
    fromEntryId?: string;
    toEntryId?: string;
  }): Promise<Record<string, unknown>> {
    // ion: get_batch_diffs（turn 聚合）；字段防御式映射到 pi 的 {files, summary}
    const result = await this.transport.sessionCall<Record<string, unknown>>(
      this.sessionId,
      "get_batch_diffs",
      options?.toEntryId ? { toTurn: options.toEntryId } : {},
    );
    const files = Array.isArray(result?.files) ? result.files : [];
    const summary = (result?.summary ?? {}) as Record<string, unknown>;
    return {
      files,
      summary: {
        totalFiles: summary.totalFiles ?? summary.total ?? files.length,
        added: summary.added ?? 0,
        modified: summary.modified ?? 0,
        deleted: summary.deleted ?? 0,
      },
    };
  }
  async getFileHistory(options: { filePath: string }): Promise<Record<string, unknown>> {
    // ion: {path, history:[{turnId, action, toolCallId, tool, hash}], count}
    // → pi: {history:[{entryId, turnIndex, timestamp, status, snapshotHash, previousHash}]}
    const result = await this.transport.sessionCall<{
      history?: Array<{ turnId?: unknown; action?: string; hash?: string }>;
    }>(this.sessionId, "get_file_history", { filePath: options.filePath });
    const raw = Array.isArray(result?.history) ? (result.history ?? []) : [];
    const history = raw.map((h) => ({
      entryId: typeof h.turnId === "string" ? h.turnId : String(h.turnId ?? ""),
      turnIndex: typeof h.turnId === "number" ? h.turnId : 0,
      timestamp: new Date().toISOString(),
      status: h.action === "added" || h.action === "deleted" ? h.action : "modified",
      snapshotHash: h.hash ?? "",
      previousHash: null,
    }));
    return { history };
  }
  async setSettings(): Promise<never> {
    notImplemented("setSettings");
  }
  async setAutoRetry(): Promise<never> {
    notImplemented("setAutoRetry");
  }
  async abortRetry(): Promise<never> {
    notImplemented("abortRetry");
  }
  async getSystemPrompt(): Promise<never> {
    notImplemented("getSystemPrompt（ion 实测返回用户消息，疑上游 bug）");
  }
  async getFlags(): Promise<never> {
    notImplemented("getFlags");
  }
  async getFlagValues(): Promise<never> {
    notImplemented("getFlagValues");
  }
  async setFlag(): Promise<never> {
    notImplemented("setFlag");
  }
  async getAgentsFiles(): Promise<never> {
    notImplemented("getAgentsFiles");
  }
  async getLatestAgentChange(): Promise<never> {
    notImplemented("getLatestAgentChange");
  }
  async switchAgent(agentName: string): Promise<Record<string, unknown>> {
    // ion: switch_agent（agentName|name 双键，实测源码）；返回按 pi 形状兜底
    const result = await this.transport.sessionCall<Record<string, unknown>>(
      this.sessionId,
      "switch_agent",
      { agentName },
    );
    return {
      agentName: (result?.agentName as string) ?? (result?.name as string) ?? agentName,
      tools: Array.isArray(result?.tools) ? (result.tools as string[]) : [],
    };
  }
  async toggleMcpServer(): Promise<never> {
    notImplemented("toggleMcpServer");
  }
  async restartMcpServer(): Promise<never> {
    notImplemented("restartMcpServer");
  }
  async registerRemoteTool(): Promise<never> {
    notImplemented("registerRemoteTool");
  }
  async unregisterRemoteTool(): Promise<never> {
    notImplemented("unregisterRemoteTool");
  }
  sendRemoteToolResult(): void {
    notImplemented("sendRemoteToolResult");
  }
  onRemoteToolCall(): () => void {
    notImplemented("onRemoteToolCall");
  }
  promoteQueuedFollowUp(): Promise<void> {
    return Promise.resolve(); // 可选方法（SandboxRpcClient 也未实现）
  }
}

/** 接缝转换：process-manager 以 RpcClientAPI 消费 */
export function asRpcClientAPI(client: IonRpcClient): RpcClientAPI {
  return client as unknown as RpcClientAPI;
}

/** channel 调用执行：查映射表 → 顶层 RPC 或 extension_rpc → 形状适配 */
async function callIonChannelTarget(
  transport: IonSocketTransport,
  sessionId: string,
  channelName: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
): Promise<unknown> {
  const target = lookupIonChannel(channelName, method);
  if (!target) {
    throw new Error(
      `ion backend: channel ${channelName}.${method} not mapped (see docs/plans/ion-backend/contract-matrix.md §2)`,
    );
  }
  const options = timeoutMs ? { timeoutMs } : undefined;
  if (target.kind === "rpc") {
    const ionParams = target.adaptParams ? target.adaptParams(params) : params;
    const result = await transport.sessionCall<unknown>(
      sessionId,
      target.method,
      ionParams,
      options,
    );
    return target.adaptResult ? target.adaptResult(result) : result;
  }
  const result = await transport.sessionCall<{ output?: unknown }>(
    sessionId,
    "extension_rpc",
    { extension: target.extension, method: target.method, args: params },
    options,
  );
  return target.adaptResult ? target.adaptResult(result?.output) : (result?.output ?? result);
}
