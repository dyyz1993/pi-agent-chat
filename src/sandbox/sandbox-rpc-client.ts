/**
 * SandboxRpcClient — 通过 HTTP 转发到沙箱容器的 RpcClient 实现
 *
 * 实现 RpcClientAPI 接口，所有方法调用都通过 HTTP POST 发送到
 * sandbox-agent（运行在沙箱容器内），由后者在隔离环境中执行。
 *
 * 使用方式：
 *   const client = new SandboxRpcClient("http://sandbox-A:3101");
 *   await client.start();
 *   await client.prompt("hello");
 *   const result = await client.bash("ls");
 */

import type {
  RpcClientAPI,
  RpcSessionState,
  CompactionResult,
  ModelCycleResult,
} from "@dyyz1993/pi-coding-agent";
import type { AgentEvent, AgentMessage, ThinkingLevel } from "@dyyz1993/pi-agent-core";
import type { Settings, SessionStats, Channel } from "@dyyz1993/pi-coding-agent";
import type { ImageContent } from "@dyyz1993/pi-ai";
import { createLogger } from "../shared/lib/logger";

type InferReturn<K extends keyof RpcClientAPI> = RpcClientAPI[K] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never;
type BashResult = InferReturn<"bash">;
type RpcSkill = InferReturn<"getSkills"> extends Array<infer T> ? T : never;
type RpcTool = InferReturn<"getTools"> extends Array<infer T> ? T : never;
type RpcExtension = InferReturn<"getExtensions"> extends Array<infer T> ? T : never;
type ForkResult = InferReturn<"fork">;
type RollbackPreviewResult = InferReturn<"previewRollback">;
type SessionOperationResult = InferReturn<"newSession">;
type SystemPromptResult = InferReturn<"getSystemPrompt">;
type QueueState = InferReturn<"getQueue">;
type TreeWithLeaf = InferReturn<"getTreeWithLeaf">;
type RemoteToolCall = Parameters<Parameters<RpcClientAPI["onRemoteToolCall"]>[0]>[0];
type RemoteToolResult = Parameters<RpcClientAPI["sendRemoteToolResult"]>[1];
type RpcSlashCommand = InferReturn<"getCommands"> extends Array<infer T> ? T : never;
type RpcContextUsage = InferReturn<"getContextUsage">;
type RpcExtensionFlag = InferReturn<"getFlags"> extends Array<infer T> ? T : never;
type RpcMcpServer = InferReturn<"getMcpServers"> extends Array<infer T> ? T : never;
type AgentsFile = InferReturn<"getAgentsFiles"> extends Array<infer T> ? T : never;

const log = createLogger("sandbox-rpc");

export class SandboxRpcClient {
  private endpoint: string;
  private _stderr = "";
  private eventListeners = new Set<(event: AgentEvent) => void>();
  private _started = false;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  /** HTTP POST 调用沙箱的 RPC 方法 */
  private async call<T>(method: string, ...params: unknown[]): Promise<T> {
    const url = `${this.endpoint}/rpc`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
        signal: controller.signal,
      });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      throw new Error(
        `Sandbox RPC ${method} failed after ${ms}ms: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Sandbox RPC ${method} failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Sandbox RPC failed");
    const ms = Math.round(performance.now() - t0);
    if (ms > 3000) {
      log.warn("[sandbox] slow RPC", { method, ms });
    }
    return json.data as T;
  }

  // ─── Lifecycle ───────────────────────────────────────────

  async start(): Promise<void> {
    log.info("Connecting to sandbox", { endpoint: this.endpoint });
    // 检查沙箱健康
    const healthController = new AbortController();
    const healthTimeout = setTimeout(() => healthController.abort(), 10_000);
    let healthRes: Response;
    try {
      healthRes = await fetch(`${this.endpoint}/health`, { signal: healthController.signal });
    } finally {
      clearTimeout(healthTimeout);
    }
    if (!healthRes.ok) throw new Error(`Sandbox not reachable: ${healthRes.status}`);
    this._started = true;

    // 启动事件流（SSE）
    // 注：浏览器环境的 EventSource 和 Node 不同，我们用 fetch + 手动读
    this.pollEvents();
    log.info("Sandbox connected", { endpoint: this.endpoint });
  }

  private async pollEvents(): Promise<void> {
    try {
      const res = await fetch(`${this.endpoint}/events`);
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (this._started) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as AgentEvent;
              for (const listener of this.eventListeners) listener(event);
            } catch {
              /* skip malformed */
            }
          }
        }
      }
    } catch (err) {
      log.warn("Event polling error", { error: String(err) });
      if (this._started) {
        setTimeout(() => this.pollEvents(), 1000);
      }
    }
  }

  async stop(): Promise<void> {
    this._started = false;
    this.eventListeners.clear();
    try {
      await this.call("agent.stop");
    } catch {
      /* ignore */
    }
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getStderr(): string {
    return this._stderr;
  }

  // ─── Prompting ──────────────────────────────────────────

  async prompt(message: string, images?: ImageContent[]): Promise<void> {
    return this.call("agent.prompt", message, images);
  }

  async steer(message: string, images?: ImageContent[]): Promise<void> {
    return this.call("agent.steer", message, images);
  }

  async followUp(message: string, images?: ImageContent[]): Promise<void> {
    return this.call("agent.followUp", message, images);
  }

  async abort(): Promise<void> {
    return this.call("agent.abort");
  }

  // ─── Session ────────────────────────────────────────────

  async newSession(parentSession?: string): Promise<SessionOperationResult> {
    return this.call("agent.newSession", parentSession);
  }

  async getState(): Promise<RpcSessionState> {
    return this.call("agent.getState");
  }

  async exportHtml(outputPath?: string): Promise<{ path: string }> {
    return this.call("agent.exportHtml", outputPath);
  }

  async fork(entryId: string, options?: { position?: "before" | "at" }): Promise<ForkResult> {
    return this.call("agent.fork", entryId, options);
  }

  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; skipFiles?: boolean },
  ): Promise<
    SessionOperationResult & { editorText?: string; newLeafId: string | null; reason?: string }
  > {
    return this.call("agent.navigateTree", targetId, options);
  }

  async previewRollback(targetId: string): Promise<RollbackPreviewResult> {
    return this.call("agent.previewRollback", targetId);
  }

  async clone(): Promise<SessionOperationResult> {
    return this.call("agent.clone");
  }

  async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
    return this.call("agent.getForkMessages");
  }

  async getLastAssistantText(): Promise<string | null> {
    return this.call("agent.getLastAssistantText");
  }

  async setSessionName(name: string): Promise<void> {
    return this.call("agent.setSessionName", name);
  }

  async getFullMessages(options?: {
    afterEntryId?: string;
    limit?: number;
    fromStart?: boolean;
  }): Promise<{
    messages: AgentMessage[];
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
    tree: {
      entries: Array<{ id: string; parentId: string | null; type: string; label?: string }>;
      leafId: string | null;
    };
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    compactionEntries: Array<{
      id: string;
      summary: string;
      tokensBefore: number | undefined;
      timestamp: number;
    }>;
  }> {
    return this.call("agent.getFullMessages", options);
  }

  async getMessageNavPage(options?: {
    afterEntryId?: string;
    limit?: number;
    fromStart?: boolean;
  }): Promise<{
    messages: AgentMessage[];
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }> {
    return this.call("agent.getMessageNavPage", options);
  }

  async getFullMessagesAround(options: {
    targetEntryId: string;
    before?: number;
    after?: number;
  }): Promise<{
    messages: AgentMessage[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    beforeCursor: string | null;
    afterCursor: string | null;
    targetFound: boolean;
    totalCount: number;
  }> {
    return this.call("agent.getFullMessagesAround", options);
  }

  async getTree(): Promise<{
    entries: Array<{ id: string; parentId: string | null; type: string; label?: string }>;
  }> {
    return this.call("agent.getTree");
  }

  async getTreeWithLeaf(): Promise<TreeWithLeaf> {
    return this.call("agent.getTreeWithLeaf");
  }

  // ─── File operations ────────────────────────────────────

  async getModifiedFiles(
    options?: { fromEntryId?: string; toEntryId?: string; toUserMsgEntryId?: string } & Record<
      string,
      unknown
    >,
  ): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      turnIndex: number;
      entryId: string;
    }>;
    resolvedFromEntryId: string | null;
  }> {
    return this.call("agent.getModifiedFiles", options);
  }

  async getFileDiff(options: {
    filePath: string;
    fromHash?: string;
    toHash?: string;
  }): Promise<{
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
  } | null> {
    return this.call("agent.getFileDiff", options);
  }

  async getBatchDiffs(options?: { fromEntryId?: string; toEntryId?: string }): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      diff: {
        path: string;
        oldContent: string | null;
        newContent: string | null;
        unifiedDiff: string;
      } | null;
    }>;
    summary: { totalFiles: number; added: number; modified: number; deleted: number };
  }> {
    return this.call("agent.getBatchDiffs", options);
  }

  async getFileHistory(options: { filePath: string }): Promise<{
    history: Array<{
      entryId: string;
      turnIndex: number;
      timestamp: string;
      status: "added" | "modified" | "deleted";
      snapshotHash: string;
      previousHash: string | null;
    }>;
  }> {
    return this.call("agent.getFileHistory", options);
  }

  // ─── Model ──────────────────────────────────────────────

  async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
    return this.call("agent.setModel", provider, modelId);
  }

  async cycleModel(): Promise<ModelCycleResult | null> {
    return this.call("agent.cycleModel");
  }

  async getAvailableModels(): Promise<
    Array<{
      provider: string;
      id: string;
      name: string;
      contextWindow: number;
      reasoning: boolean;
      input: ("text" | "image")[];
    }>
  > {
    const raw = await this.call<{
      models?: Array<{
        provider: string;
        id: string;
        name: string;
        contextWindow: number;
        reasoning: boolean;
        input: ("text" | "image")[];
      }>;
    }>("agent.getAvailableModels");
    return raw.models ?? [];
  }

  async getTierModels(): Promise<Record<string, string>> {
    return this.call("agent.getTierModels");
  }

  async setTierModels(models: { fast?: string; pro?: string; max?: string }): Promise<void> {
    return this.call("agent.setTierModels", models);
  }

  // ─── Thinking ───────────────────────────────────────────

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.call("agent.setThinkingLevel", level);
  }

  async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
    return this.call("agent.cycleThinkingLevel");
  }

  // ─── Queue modes ────────────────────────────────────────

  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return this.call("agent.setSteeringMode", mode);
  }

  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return this.call("agent.setFollowUpMode", mode);
  }

  // ─── Compaction ─────────────────────────────────────────

  async compact(customInstructions?: string): Promise<CompactionResult> {
    return this.call("agent.compact", customInstructions);
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    return this.call("agent.setAutoCompaction", enabled);
  }

  async deleteEntries(targetIds: string[]): Promise<{ entryId: string }> {
    return this.call("agent.deleteEntries", targetIds);
  }

  async summarizeEntries(
    targetIds: string[],
    options?: { summary?: string; model?: string },
  ): Promise<{ entryId: string }> {
    return this.call("agent.summarizeEntries", targetIds, options);
  }

  // ─── Retry ──────────────────────────────────────────────

  async setAutoRetry(enabled: boolean): Promise<void> {
    return this.call("agent.setAutoRetry", enabled);
  }

  async abortRetry(): Promise<void> {
    return this.call("agent.abortRetry");
  }

  // ─── Bash ───────────────────────────────────────────────

  async bash(command: string): Promise<BashResult> {
    return this.call("agent.bash", command);
  }

  async abortBash(): Promise<void> {
    return this.call("agent.abortBash");
  }

  // ─── Session stats ─────────────────────────────────────

  async getSessionStats(): Promise<SessionStats> {
    return this.call("agent.getSessionStats");
  }

  // ─── Commands / Skills / Extensions / Tools ────────────

  async getCommands(): Promise<RpcSlashCommand[]> {
    return this.call("agent.getCommands");
  }

  async getSkills(): Promise<RpcSkill[]> {
    return this.call("agent.getSkills");
  }

  async getExtensions(): Promise<RpcExtension[]> {
    return this.call("agent.getExtensions");
  }

  async getTools(): Promise<RpcTool[]> {
    return this.call("agent.getTools");
  }

  // ─── Settings ──────────────────────────────────────────

  async getSettings(scope?: "global" | "project"): Promise<Settings> {
    return this.call("agent.getSettings", scope);
  }

  async setSettings(settings: Partial<Settings>, scope?: "global" | "project"): Promise<void> {
    return this.call("agent.setSettings", settings, scope);
  }

  // ─── Context ───────────────────────────────────────────

  async getContextUsage(): Promise<RpcContextUsage> {
    return this.call("agent.getContextUsage");
  }

  async getSystemPrompt(): Promise<SystemPromptResult> {
    return this.call("agent.getSystemPrompt");
  }

  // ─── Active tools ──────────────────────────────────────

  async getActiveTools(): Promise<string[]> {
    return this.call("agent.getActiveTools");
  }

  async setActiveTools(toolNames: string[]): Promise<void> {
    return this.call("agent.setActiveTools", toolNames);
  }

  // ─── MCP ───────────────────────────────────────────────

  async getMcpServers(): Promise<RpcMcpServer[]> {
    return this.call("agent.getMcpServers");
  }

  async toggleMcpServer(name: string, enabled: boolean): Promise<void> {
    return this.call("agent.toggleMcpServer", name, enabled);
  }

  async restartMcpServer(name: string): Promise<void> {
    return this.call("agent.restartMcpServer", name);
  }

  // ─── Queue ─────────────────────────────────────────────

  async getQueue(): Promise<QueueState> {
    return this.call("agent.getQueue");
  }

  async clearQueue(): Promise<QueueState> {
    return this.call("agent.clearQueue");
  }

  // ─── Flags ─────────────────────────────────────────────

  async getFlags(): Promise<RpcExtensionFlag[]> {
    return this.call("agent.getFlags");
  }

  async getFlagValues(): Promise<Record<string, boolean | string>> {
    return this.call("agent.getFlagValues");
  }

  async setFlag(name: string, value: boolean | string): Promise<void> {
    return this.call("agent.setFlag", name, value);
  }

  // ─── Reload ────────────────────────────────────────────

  async reload(): Promise<void> {
    return this.call("agent.reload");
  }

  // ─── Set Cwd ──────────────────────────────────────────

  async setCwd(cwd: string): Promise<SessionOperationResult> {
    return this.call("agent.setCwd", cwd);
  }

  // ─── Agents files ─────────────────────────────────────

  async getAgentsFiles(): Promise<AgentsFile[]> {
    return this.call("agent.getAgentsFiles");
  }

  async getAgents(): Promise<InferReturn<"getAgents">> {
    return this.call("agent.getAgents");
  }

  async switchAgent(agentName: string): Promise<InferReturn<"switchAgent">> {
    return this.call("agent.switchAgent", agentName);
  }

  async getCurrentAgent(): Promise<InferReturn<"getCurrentAgent">> {
    return this.call("agent.getCurrentAgent");
  }

  async getLatestAgentChange(): Promise<InferReturn<"getLatestAgentChange">> {
    return this.call("agent.getLatestAgentChange");
  }

  // ─── Remote tools ─────────────────────────────────────

  async registerRemoteTool(tool: {
    name: string;
    description: string;
    parameters: object;
  }): Promise<void> {
    return this.call("agent.registerRemoteTool", tool);
  }

  async unregisterRemoteTool(name: string): Promise<void> {
    return this.call("agent.unregisterRemoteTool", name);
  }

  sendRemoteToolResult(toolCallId: string, result: RemoteToolResult): void {
    // fire-and-forget
    this.call("agent.sendRemoteToolResult", toolCallId, result).catch(() => {});
  }

  respondUI(requestId: string, response: Record<string, unknown>): void {
    this.call("agent.respondUI", requestId, response).catch(() => {});
  }

  onRemoteToolCall(_handler: (call: RemoteToolCall) => void): () => void {
    // 简化处理：暂不支持远程 tool call
    return () => {};
  }

  // ─── Helpers ───────────────────────────────────────────

  async waitForIdle(timeout?: number): Promise<void> {
    return this.call("agent.waitForIdle", timeout);
  }

  async collectEvents(timeout?: number): Promise<AgentEvent[]> {
    return this.call("agent.collectEvents", timeout);
  }

  async promptAndWait(
    message: string,
    images?: ImageContent[],
    timeout?: number,
  ): Promise<AgentEvent[]> {
    return this.call("agent.promptAndWait", message, images, timeout);
  }

  // ─── Compatibility shims for process-manager ──────────

  /**
   * Send a raw command directly to the sandbox agent.
   * Used by process-manager for switchAgent, getCurrentAgent, getLatestAgentChange, etc.
   * The sandbox-agent forwards the raw command to pi CLI.
   */
  async send(command: Record<string, unknown>): Promise<{ data: unknown }> {
    const rpcType = command.type as string;
    if (!rpcType) throw new Error("send: command must have a type");
    const url = `${this.endpoint}/rpc`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Sandbox send failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as { ok: boolean; data?: unknown; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Sandbox send failed");
      return { data: json.data ?? json };
    } catch (err) {
      throw new Error(
        `Sandbox send ${rpcType} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Used by process-manager to send a simple text prompt. */
  async sendMessage(message: string): Promise<void> {
    return this.prompt(message);
  }

  /** Get agent detail by name. Called via process-manager.getAgentDetail(). */
  async getAgentDetail(agentName: string): Promise<InferReturn<"getAgentDetail">> {
    return this.call("agent.getAgentDetail", agentName || "build");
  }

  /** Get all tools for current agent. Called via process-manager.getAllTools(). */
  async getAllTools(): Promise<InferReturn<"getAllTools">> {
    const result = await this.call<InferReturn<"getAllTools">>("agent.getAllTools");
    return result;
  }

  async setPermissionMode(
    mode: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny",
  ): Promise<{ mode: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny" }> {
    return this.call("agent.setPermissionMode", mode);
  }

  // ─── Channels ──────────────────────────────────────────

  channel(name: string): Pick<Channel, "name" | "send" | "onReceive" | "invoke" | "call"> {
    const log = createLogger("sandbox-channel");
    log.warn("Channel not available in sandbox mode, returning no-op", { channel: name });
    return {
      name,
      send: async () => {},
      onReceive: () => () => {},
      invoke: async () => undefined,
      call: async () => undefined,
    };
  }
}
