import { existsSync } from "fs";
import { createReadStream } from "fs";
import * as readline from "readline";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  ChannelDataEvent,
  ExtensionUIRequestEvent,
} from "../modules/agent";
import type { AssistantMessage, AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { TodoChannelEvent } from "../modules/todo";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import type { RulesChannelEvent, RuleSummary } from "../modules/rules";
import { createLogger } from "../lib/logger";
import { config } from "../../server-config";

const log = createLogger("agent");

const { subagent, todo, bash, lsp, preview, autoMemory, autoSessionTitle, rules, fileSnapshot } = config.piExtensionPaths;
const EXTENSION_ARGS = [
  "--no-extensions",
  "--extension", subagent,
  "--extension", todo,
  "--extension", bash,
  "--extension", lsp,
  "--extension", preview,
  "--extension", autoMemory,
  "--extension", autoSessionTitle,
  ...(rules ? ["--extension", rules] : []),
  ...(fileSnapshot ? ["--extension", fileSnapshot] : []),
];

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

function sanitizeEvent(event: AgentEvent): SanitizedEvent {
  if (event.type === "message_update") {
    const { assistantMessageEvent, ...rest } = event;
    const { partial: _, ...ameRest } = assistantMessageEvent as AssistantMessageEvent & { partial?: AssistantMessage };
    return { ...rest, assistantMessageEvent: ameRest } as SanitizedMessageUpdate;
  }
  return event as SanitizedEvent;
}

interface SubagentChannelPayload {
  sessionId: string;
  event: Record<string, unknown>;
}

interface RpcClientLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
  getStderr(): string;
  prompt(message: string): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<unknown>;
  getCommands(): Promise<unknown>;
  getSessionStats(): Promise<unknown>;
  getMessages(): Promise<unknown>;
  getAvailableModels(): Promise<unknown>;
  setModel(provider: string, modelId: string): Promise<unknown>;
  cycleModel(): Promise<unknown>;
  setThinkingLevel(level: string): Promise<void>;
  cycleThinkingLevel(): Promise<unknown>;
  compact(customInstructions?: string): Promise<unknown>;
  setAutoCompaction(enabled: boolean): Promise<void>;
  setAutoRetry(enabled: boolean): Promise<void>;
  abortRetry(): Promise<void>;
  setSteeringMode(mode: string): Promise<void>;
  setFollowUpMode(mode: string): Promise<void>;
  getActiveTools(): Promise<unknown>;
  setActiveTools(toolNames: string[]): Promise<void>;
  getQueue(): Promise<unknown>;
  clearQueue(): Promise<unknown>;
  getExtensions(): Promise<unknown>;
  getSkills(): Promise<unknown>;
  getTools(): Promise<unknown>;
  getContextUsage(): Promise<unknown>;
  getSettings(scope?: string): Promise<unknown>;
  setSettings(settings: Record<string, unknown>, scope?: string): Promise<void>;
  setSessionName(name: string): Promise<void>;
  getLastAssistantText(): Promise<unknown>;
  getForkMessages(): Promise<unknown>;
  fork(entryId: string): Promise<unknown>;
  clone(): Promise<unknown>;
  newSession(parentSession?: string): Promise<unknown>;
  exportHtml(outputPath?: string): Promise<unknown>;
  channel(name: string): { name: string; send: (data: unknown) => void; onReceive: (handler: (data: unknown) => void) => () => void };
}

interface ManagedClient {
  client: RpcClientLike;
  info: AgentProcessInfo;
  unsubscribe: () => void;
}

import type { AgentProcessInfo } from "../modules/agent";

async function createRpcClient(
  cliPath: string,
  cwd: string,
  sessionPath: string | undefined,
): Promise<RpcClientLike> {
  const mod = await import(
    "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/modes/rpc/rpc-client.js"
  ) as { RpcClient: new (options?: Record<string, unknown>) => RpcClientLike };

  const args = [...EXTENSION_ARGS];
  if (sessionPath && existsSync(sessionPath)) {
    args.push("--session", sessionPath);
  }

  const client = new mod.RpcClient({
    cliPath,
    cwd,
    args,
  });

  return client;
}

export class AgentProcessManager {
  private clients = new Map<string, ManagedClient>();
  private server: RPCServer;

  constructor(server: RPCServer) {
    this.server = server;
  }

  updateServer(server: RPCServer): void {
    this.server = server;
  }

  async start(sessionId: string, projectPath: string, sessionPath: string): Promise<{ agentId: string; status: "started" | "already_running" }> {
    const existing = this.clients.get(sessionId);
    if (existing) {
      return { agentId: sessionId, status: "already_running" };
    }

    const client = await createRpcClient(config.piCliPath, projectPath, sessionPath);

    log.info("Spawning pi via RpcClient", { cwd: projectPath, sessionPath });

    const info: AgentProcessInfo = {
      sessionId,
      projectPath,
      sessionPath,
      status: "idle",
      holdEvents: [],
    };

    const unsubscribe = client.onEvent((event) => {
      this.handleEvent(sessionId, event);
    });

    for (const name of ["bash", "todo", "subagent", "lsp", "rules-engine"] as const) {
      client.channel(name).onReceive((data: unknown) => {
        this.handleEvent(sessionId, { type: "channel_data", name, data } as ChannelDataEvent);
      });
    }

    await client.start();

    log.info("RpcClient started");

    this.clients.set(sessionId, { client, info, unsubscribe });
    return { agentId: sessionId, status: "started" };
  }

  async replayHoldEvents(sessionId: string): Promise<{ replayed: number }> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { replayed: 0 };
    const events = managed.info.holdEvents;
    for (const evt of events) {
      await this.emitAgentEvent(sessionId, evt as SanitizedEvent);
    }
    return { replayed: events.length };
  }

  send(sessionId: string, content: string): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) {
      log.warn("send: no client", { sessionId });
      return false;
    }
    managed.client.prompt(content).catch((err: Error) => {
      log.warn("prompt error", { err: err.message });
    });
    return true;
  }

  steer(sessionId: string, content: string): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;
    managed.client.steer(content).catch(() => {});
    return true;
  }

  followUp(sessionId: string, content: string): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;
    managed.client.followUp(content).catch(() => {});
    return true;
  }

  async abort(sessionId: string): Promise<boolean> {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;
    await managed.client.abort().catch(() => {});
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;

    const ch = managed.client.channel("ui");
    ch.send({ id: requestId, ...response });
    return true;
  }

  stop(sessionId: string): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;

    managed.unsubscribe();
    managed.client.stop().catch(() => {});
    this.clients.delete(sessionId);
    return true;
  }

  getStatus(sessionId: string): { status: "idle" | "streaming" | "stopped"; pid?: number } {
    const managed = this.clients.get(sessionId);
    if (!managed) return { status: "stopped" };
    return { status: managed.info.status };
  }

  async getState(sessionId: string): Promise<{
    model?: { id: string; name?: string; provider?: string; reasoning?: boolean; contextWindow: number; maxTokens: number };
    thinkingLevel?: string;
    isStreaming: boolean;
    isCompacting: boolean;
    messageCount: number;
  } | null> {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;

    try {
      const raw = await managed.client.getState() as Record<string, unknown>;
      if (!raw) return null;
      const model = raw.model as Record<string, unknown> | undefined;
      return {
        model: model ? {
          id: String(model.id ?? ""),
          name: model.name ? String(model.name) : undefined,
          provider: model.provider ? String(model.provider) : undefined,
          reasoning: Boolean(model.reasoning),
          contextWindow: Number(model.contextWindow ?? 0),
          maxTokens: Number(model.maxTokens ?? 0),
        } : undefined,
        thinkingLevel: raw.thinkingLevel ? String(raw.thinkingLevel) : undefined,
        isStreaming: Boolean(raw.isStreaming),
        isCompacting: Boolean(raw.isCompacting),
        messageCount: Number(raw.messageCount ?? 0),
      };
    } catch {
      return null;
    }
  }

  async getCommands(sessionId: string): Promise<Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>> {
    const managed = this.clients.get(sessionId);
    if (!managed) return [];

    try {
      const raw = await managed.client.getCommands() as Record<string, unknown>;
      if (!raw) return [];
      const list = (raw.commands ?? raw) as Array<Record<string, unknown>>;
      if (!Array.isArray(list)) return [];
      return list.map((c) => ({
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
        source: (c.source as "extension" | "prompt" | "skill") ?? "extension",
      }));
    } catch {
      return [];
    }
  }

  async getSessionStats(sessionId: string): Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null> {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;

    try {
      const raw = await managed.client.getSessionStats() as Record<string, unknown>;
      if (!raw) return null;
      const tokens = raw.tokens as Record<string, unknown> | undefined;
      const cu = raw.contextUsage as Record<string, unknown> | undefined;
      return {
        tokens: {
          input: Number(tokens?.input ?? 0),
          output: Number(tokens?.output ?? 0),
          cacheRead: Number(tokens?.cacheRead ?? 0),
          cacheWrite: Number(tokens?.cacheWrite ?? 0),
          total: Number(tokens?.total ?? 0),
        },
        cost: Number(raw.cost ?? 0),
        contextUsage: cu ? {
          tokens: cu.tokens as number | null,
          contextWindow: Number(cu.contextWindow ?? 0),
          percent: cu.percent as number | null,
        } : undefined,
      };
    } catch {
      return null;
    }
  }

  async getMessages(sessionId: string): Promise<{ messages: unknown[]; customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> }> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { messages: [], customEntries: [] };

    let messages: unknown[] = [];
    try {
      const raw = await managed.client.getMessages() as Record<string, unknown>;
      if (raw) {
        messages = (raw.messages ?? raw) as unknown[];
      }
    } catch {}

    const customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> = [];
    const sessionPath = managed.info.sessionPath;
    if (sessionPath && existsSync(sessionPath)) {
      try {
        const rl = readline.createInterface({
          input: createReadStream(sessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "custom") {
              customEntries.push({
                id: parsed.id || `custom-${Date.now()}`,
                customType: parsed.customType || "unknown",
                data: parsed.data,
                timestamp: new Date(parsed.timestamp || 0).getTime(),
              });
            }
          } catch {}
        }
        rl.close();
      } catch (err) {
        log.warn("Failed to read custom entries from JSONL", { err: err instanceof Error ? err.message : String(err) });
      }
    }

    return { messages, customEntries };
  }

  async getAvailableModels(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return [];
    return managed.client.getAvailableModels().catch(() => []);
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.setModel(provider, modelId);
  }

  async cycleModel(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;
    return managed.client.cycleModel().catch(() => null);
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setThinkingLevel(level).catch(() => {});
  }

  async cycleThinkingLevel(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;
    return managed.client.cycleThinkingLevel().catch(() => null);
  }

  async compact(sessionId: string, customInstructions?: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.compact(customInstructions);
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setAutoCompaction(enabled).catch(() => {});
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setAutoRetry(enabled).catch(() => {});
  }

  async abortRetry(sessionId: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.abortRetry().catch(() => {});
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setSteeringMode(mode as "all" | "one-at-a-time").catch(() => {});
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setFollowUpMode(mode as "all" | "one-at-a-time").catch(() => {});
  }

  async getActiveTools(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { toolNames: [] };
    return managed.client.getActiveTools().catch(() => ({ toolNames: [] }));
  }

  async setActiveTools(sessionId: string, toolNames: string[]): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setActiveTools(toolNames).catch(() => {});
  }

  async getQueue(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { steering: [], followUp: [] };
    return managed.client.getQueue().catch(() => ({ steering: [], followUp: [] }));
  }

  async clearQueue(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { steering: [], followUp: [] };
    return managed.client.clearQueue().catch(() => ({ steering: [], followUp: [] }));
  }

  async getExtensions(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { extensions: [] };
    return managed.client.getExtensions().catch(() => ({ extensions: [] }));
  }

  async getSkills(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { skills: [] };
    return managed.client.getSkills().catch(() => ({ skills: [] }));
  }

  async getTools(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { tools: [] };
    return managed.client.getTools().catch(() => ({ tools: [] }));
  }

  async getContextUsage(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { tokens: null, contextWindow: 0, percent: null };
    return managed.client.getContextUsage().catch(() => ({ tokens: null, contextWindow: 0, percent: null }));
  }

  async getSettings(sessionId: string, scope?: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return {};
    return managed.client.getSettings(scope).catch(() => ({}));
  }

  async setSettings(sessionId: string, settings: Record<string, unknown>, scope?: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setSettings(settings, scope).catch(() => {});
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setSessionName(name).catch(() => {});
  }

  async getLastAssistantText(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { text: null };
    return managed.client.getLastAssistantText().catch(() => ({ text: null }));
  }

  async getForkMessages(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return { messages: [] };
    return managed.client.getForkMessages().catch(() => ({ messages: [] }));
  }

  async fork(sessionId: string, entryId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.fork(entryId);
  }

  async clone(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.clone();
  }

  async newSession(sessionId: string, parentSession?: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.newSession(parentSession);
  }

  async exportHtml(sessionId: string, outputPath?: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.exportHtml(outputPath);
  }

  sendChannelData(sessionId: string, channelName: string, data: unknown): void {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    const ch = managed.client.channel(channelName);
    ch.send(data);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    const managed = this.clients.get(sessionId);
    if (!managed) return;

    if (event.type === "channel_data") {
      const ch = event as ChannelDataEvent;
      if (ch.name === "subagent") {
        this.handleSubagentChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "todo") {
        this.handleTodoChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "bash") {
        this.handleBashChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "lsp") {
        this.handleLspChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "rules-engine") {
        this.handleRulesChannelData(sessionId, ch);
        return;
      }
    }

    if (event.type === "extension_ui_request") {
      const ui = event as ExtensionUIRequestEvent;
      const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
      if (ui.method === "notify") {
        this.server.emitEvent("agent.notify", {
          sessionId,
          message: ui.message ?? "",
          notifyType: ui.notifyType ?? "info",
        }, { sessionId }).catch(() => {});
        return;
      }
      if (!INTERACTIVE_METHODS.has(ui.method)) return;
    }

    if (event.type === "agent_start") {
      managed.info.status = "streaming";
      managed.info.holdEvents = [];
    }

    if (event.type === "agent_end") {
      managed.info.status = "idle";
      managed.info.holdEvents = [];
    }

    if (event.type === "message_end") {
      managed.info.holdEvents = [];
    }

    if (event.type === "message_update") {
      managed.info.status = "streaming";
    }

    const sanitized = sanitizeEvent(event);

    if (managed.info.status === "streaming") {
      managed.info.holdEvents.push(sanitized);
    }

    this.emitAgentEvent(sessionId, sanitized);
  }

  private async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as SubagentChannelPayload | undefined;
    if (!data) return;

    const { event: subEvent, sessionId: subSessionId } = data;
    if (!subEvent || !subSessionId) return;

    const eventType = subEvent.type as string;
    if (eventType === "response") return;

    const managed = this.clients.get(parentSessionId);
    const sessionPath = managed?.info.sessionPath || "";

    if (eventType === "message_end" && subEvent.message) {
      const msg = subEvent.message as { content?: Array<{ type: string; text?: string }> };
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "text") {
            log.info("Subagent final text", {
              parentSessionId,
              subSessionId,
              textLength: part.text?.length,
            });
          }
        }
      }
    }

    await this.server.emitEvent(
      "subagent.event",
      { parentSessionId, parentSessionPath: sessionPath, subSessionId, event: subEvent },
      { parentSessionId },
    );
  }

  private async handleTodoChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as TodoChannelEvent | undefined;
    if (!data) return;

    log.info("Todo channel data", { sessionId, action: data.action, count: data.todos?.length });

    await this.server.emitEvent(
      "todo.event",
      { sessionId, action: data.action, todos: data.todos, timestamp: data.timestamp },
      { sessionId },
    );
  }

  private async handleBashChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as BashChannelEvent | undefined;
    if (!data) return;

    log.info("Bash channel data", { sessionId, type: data.type, toolCallId: data.toolCallId });

    await this.server.emitEvent(
      "bash.event",
      { sessionId, event: data },
      { sessionId },
    );
  }

  private async handleLspChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as LspChannelEvent | undefined;
    if (!data) return;

    log.info("LSP channel data", { sessionId, event: data.event });

    await this.server.emitEvent(
      "lsp.event",
      { sessionId, event: data },
      { sessionId },
    );
  }

  private async handleRulesChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown>;
    if (!data) return;

    const rawType = data.type as string;
    log.info("Rules channel data", { sessionId, type: rawType });

    const now = Date.now();
    let mappedEvent: RulesChannelEvent | null = null;

    if (rawType === "session_start") {
      const rawRules = (data.rules as Array<Record<string, unknown>>) || [];
      mappedEvent = {
        type: "rules.loaded",
        totalRules: (data.totalRules as number) || 0,
        unconditional: (data.unconditional as number) || 0,
        conditional: (data.conditional as number) || 0,
        rules: rawRules.map(
          (r): RuleSummary => ({
            name: r.name as string,
            title: r.title as string,
            scope: ((r.scope as string) || "project") as RuleSummary["scope"],
            source: r.source as string,
            severity: ((r.severity as string) || "medium") as RuleSummary["severity"],
            isUnconditional: Boolean(r.isUnconditional),
            paths: (r.paths as string[]) || [],
            content: (r.content as string) || "",
            loadedAt: now,
            expiresAt: now + 30000,
            status: "active" as const,
          }),
        ),
        loadedAt: now,
        cacheTTL: 30000,
      };
    } else if (rawType === "before_agent_start") {
      mappedEvent = {
        type: "rules.injected",
        injectedCount: (data.unconditional as number) || 0,
        systemPromptDelta: (data.systemPromptLength as number) || 0,
        ruleNames: [],
      };
    } else if (rawType === "session_shutdown") {
      mappedEvent = {
        type: "rules.unloaded",
        reason: "session_shutdown",
      };
    }

    if (!mappedEvent) return;

    await this.server.emitEvent(
      "rules.event",
      { sessionId, event: mappedEvent },
      { sessionId },
    );
  }

  private async emitAgentEvent(sessionId: string, event: SanitizedEvent): Promise<void> {
    await this.server.emitEvent(
      "agent.event",
      { sessionId, event },
      { sessionId },
    );
  }
}
