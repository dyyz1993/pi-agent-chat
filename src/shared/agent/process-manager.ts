import { existsSync, mkdirSync } from "fs";
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
import type { RulesChannelEvent } from "../modules/rules";
import type { RpcClientAPI } from "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/modes/rpc/rpc-client-types";
import { createLogger } from "../lib/logger";
import { config } from "../../server-config";

const log = createLogger("agent");

const { subagent, todo, bash, lsp, preview, autoMemory, autoSessionTitle, rules, fileSnapshot, askTools, messageBridge } = config.piExtensionPaths;
const EXTENSION_ARGS = [
  "--no-extensions",
  ...[subagent, todo, bash, lsp, preview, autoMemory, autoSessionTitle, rules, fileSnapshot, askTools, messageBridge]
    .filter((p): p is string => !!p)
    .flatMap((p) => ["--extension", p]),
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

type RpcClientInstance = RpcClientAPI;

interface ManagedClient {
  client: RpcClientInstance;
  info: AgentProcessInfo;
  unsubscribe: () => void;
}

import type { AgentProcessInfo } from "../modules/agent";

async function createRpcClient(
  cliPath: string,
  cwd: string,
  sessionPath: string | undefined,
): Promise<RpcClientInstance> {
  const mod = await import(
    "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/modes/rpc/rpc-client.js"
  ) as { RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI };

  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

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
  private servers = new Set<RPCServer>();
  private sessionPaths = new Map<string, string>();
  private leafIds = new Map<string, string | null>();
  private lastLspState = new Map<string, { state: string; servers: unknown[]; mode?: string; activeLanguages?: string[] }>();

  constructor(server: RPCServer) {
    this.servers.add(server);
  }

  updateServer(server: RPCServer): void {
    this.servers.add(server);
  }

  removeServer(server: RPCServer): void {
    this.servers.delete(server);
  }

  serverCount(): number {
    return this.servers.size;
  }

  private async broadcastEvent(eventType: string, payload: unknown, metadata?: unknown): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.emitEvent(eventType, payload, metadata);
      } catch {
        this.servers.delete(server);
      }
    }
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

    const bridge = (event: unknown): void => {
      this.handleEvent(sessionId, event as AgentEvent);
    };
    const unsubscribe = client.onEvent(bridge);

    for (const name of ["bash", "todo", "subagent", "lsp", "rules-engine", "memory"] as const) {
      client.channel(name).onReceive((data: unknown) => {
        this.handleEvent(sessionId, { type: "channel_data", name, data } as ChannelDataEvent);
      });
    }

    this.clients.set(sessionId, { client, info, unsubscribe });

    await client.start();

    log.info("RpcClient started", { sessionId });
    this.sessionPaths.set(sessionId, sessionPath);
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

  async setCwd(sessionId: string, cwd: string): Promise<boolean> {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;
    await managed.client.setCwd(cwd).catch(() => {});
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;

    managed.client.respondUI(requestId, response);
    return true;
  }

  stop(sessionId: string): boolean {
    const managed = this.clients.get(sessionId);
    if (!managed) return false;

    managed.info.status = "idle";
    this.emitAgentEvent(sessionId, { type: "agent_end" } as SanitizedEvent).catch(() => {});

    managed.unsubscribe();
    managed.client.stop().catch(() => {});
    this.clients.delete(sessionId);
    this.sessionPaths.delete(sessionId);
    return true;
  }

  getStatus(sessionId: string): { status: "idle" | "streaming" | "stopped"; pid?: number } {
    const managed = this.clients.get(sessionId);
    if (!managed) return { status: "stopped" };
    return { status: managed.info.status };
  }

  private async readJsonlEntries(sessionPath: string): Promise<Array<{ id: string; parentId: string | null; type: string; customType?: string }>> {
    const entries: Array<{ id: string; parentId: string | null; type: string; customType?: string }> = [];
    if (!sessionPath || !existsSync(sessionPath)) return entries;
    try {
      const rl = readline.createInterface({
        input: createReadStream(sessionPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.id && parsed.type) {
            entries.push({
              id: parsed.id as string,
              parentId: (parsed.parentId as string | null | undefined) ?? null,
              type: parsed.type as string,
              customType: parsed.customType as string | undefined,
            });
          }
        } catch {}
      }
      rl.close();
    } catch {}
    return entries;
  }

  private resolveSessionPath(sessionId: string): string {
    const managed = this.clients.get(sessionId);
    if (managed) return managed.info.sessionPath;
    return this.sessionPaths.get(sessionId) ?? "";
  }

  private buildMessagesFromJsonl(
    _entries: Array<{ id: string; parentId: string | null; type: string }>,
    _leafId: string | null,
  ): unknown[] {
    return [];
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
      const state = await managed.client.getState();
      const model = state.model;
      return {
        model: model ? {
          id: String(model.id ?? ""),
          name: model.name ? String(model.name) : undefined,
          provider: model.provider ? String(model.provider) : undefined,
          reasoning: Boolean(model.reasoning),
          contextWindow: Number(model.contextWindow ?? 0),
          maxTokens: Number(model.maxTokens ?? 0),
        } : undefined,
        thinkingLevel: state.thinkingLevel ? String(state.thinkingLevel) : undefined,
        isStreaming: Boolean(state.isStreaming),
        isCompacting: Boolean(state.isCompacting),
        messageCount: Number(state.messageCount ?? 0),
      };
    } catch {
      return null;
    }
  }

  async getCommands(sessionId: string): Promise<Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>> {
    const managed = this.clients.get(sessionId);
    if (!managed) return [];

    try {
      const commands = await managed.client.getCommands();
      if (!commands) return [];
      return commands.map((c) => ({
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
        source: c.source ?? "extension",
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
      const stats = await managed.client.getSessionStats();
      if (!stats) return null;
      const tokens = stats.tokens;
      const cu = stats.contextUsage;
      return {
        tokens: {
          input: Number(tokens?.input ?? 0),
          output: Number(tokens?.output ?? 0),
          cacheRead: Number(tokens?.cacheRead ?? 0),
          cacheWrite: Number(tokens?.cacheWrite ?? 0),
          total: Number(tokens?.total ?? 0),
        },
        cost: Number(stats.cost ?? 0),
        contextUsage: cu ? {
          tokens: cu.tokens,
          contextWindow: Number(cu.contextWindow ?? 0),
          percent: cu.percent,
        } : undefined,
      };
    } catch {
      return null;
    }
  }

  async getMessages(sessionId: string, sessionPath?: string): Promise<{ messages: unknown[]; customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> }> {
    const managed = this.clients.get(sessionId);

    let messages: unknown[] = [];
    let resolvedSessionPath = sessionPath ?? "";
    let activePathIds: Set<string> | null = null;

    if (managed) {
      resolvedSessionPath = managed.info.sessionPath;
      try {
        const messagesResult = await managed.client.getMessages();
        if (messagesResult) {
          messages = messagesResult;
        }
      } catch {}
      try {
        const treeResult = await managed.client.getTreeWithLeaf();
        const entries = treeResult.entries;
        const leafId = treeResult.leafId;
        if (Array.isArray(entries) && leafId) {
          const byId = new Map<string, { id: string; parentId: string | null; type: string; label?: string }>();
          for (const e of entries) {
            byId.set(e.id, e);
          }
          activePathIds = new Set<string>();
          let curId: string | null | undefined = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node && typeof node.parentId === "string" && node.parentId ? node.parentId : undefined;
          }
        }
      } catch {}
    } else {
      resolvedSessionPath = this.resolveSessionPath(sessionId) ?? sessionPath ?? "";
      const leafId = this.leafIds.get(sessionId) ?? null;
      if (resolvedSessionPath && leafId !== undefined) {
        const jsonlEntries = await this.readJsonlEntries(resolvedSessionPath);
        if (jsonlEntries.length > 0 && leafId !== null) {
          const byId = new Map<string, { id: string; parentId: string | null; type: string; customType?: string }>();
          for (const e of jsonlEntries) byId.set(e.id, e);
          activePathIds = new Set<string>();
          let curId: string | null = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node?.parentId ?? null;
          }
        }
        messages = this.buildMessagesFromJsonl(jsonlEntries, leafId);
      }
    }

    const customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> = [];
    if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
      try {
        const rl = readline.createInterface({
          input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === "custom") {
              if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id as string)) continue;
              customEntries.push({
                id: (parsed.id as string) ?? `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "compaction") {
              if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id as string)) continue;
              messages.push({
                id: parsed.id,
                role: "compactionSummary",
                summary: parsed.summary ?? "",
                tokensBefore: parsed.tokensBefore,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (!managed && parsed.type === "message" && parsed.message) {
              if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id as string)) continue;
              messages.push(parsed.message);
            }
          } catch {}
        }
        rl.close();
      } catch (err) {
        log.warn("Failed to read entries from JSONL", { err: err instanceof Error ? err.message : String(err) });
      }
    }

    return { messages, customEntries };
  }

  async getFullMessages(sessionId: string, sessionPath?: string): Promise<{ messages: unknown[]; customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> }> {
    const managed = this.clients.get(sessionId);

    let messages: unknown[] = [];
    let resolvedSessionPath = sessionPath ?? "";
    let activePathIds: Set<string> | null = null;

    if (managed) {
      resolvedSessionPath = managed.info.sessionPath;
      try {
        const result = await managed.client.getFullMessages();
        log.info("getFullMessages SDK result", { count: result?.messages?.length ?? 0, hasMore: result?.hasMore, totalCount: result?.totalCount });
        if (result?.messages) {
          messages = result.messages;
        }
      } catch (err) {
        log.error("getFullMessages SDK failed, falling back to getMessages", { err: err instanceof Error ? err.message : String(err) });
        try {
          const fallback = await managed.client.getMessages();
          if (fallback) messages = fallback;
        } catch {}
      }
      try {
        const treeResult = await managed.client.getTreeWithLeaf();
        const entries = treeResult.entries;
        const leafId = treeResult.leafId;
        if (Array.isArray(entries) && leafId) {
          const byId = new Map<string, { id: string; parentId: string | null; type: string; label?: string }>();
          for (const e of entries) byId.set(e.id, e);
          activePathIds = new Set<string>();
          let curId: string | null | undefined = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node && typeof node.parentId === "string" && node.parentId ? node.parentId : undefined;
          }
        }
      } catch {}
    } else {
      resolvedSessionPath = this.resolveSessionPath(sessionId) ?? sessionPath ?? "";
      const leafId = this.leafIds.get(sessionId) ?? null;
      if (resolvedSessionPath && leafId !== undefined) {
        const jsonlEntries = await this.readJsonlEntries(resolvedSessionPath);
        if (jsonlEntries.length > 0 && leafId !== null) {
          const byId = new Map<string, { id: string; parentId: string | null; type: string; customType?: string }>();
          for (const e of jsonlEntries) byId.set(e.id, e);
          activePathIds = new Set<string>();
          let curId: string | null = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node?.parentId ?? null;
          }
        }
        messages = this.buildMessagesFromJsonl(jsonlEntries, leafId);
      }
    }

    const customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }> = [];
    if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
      try {
        const rl = readline.createInterface({
          input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === "custom") {
              if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id as string)) continue;
              customEntries.push({
                id: (parsed.id as string) ?? `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "compaction") {
              if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id as string)) continue;
              messages.push({
                id: parsed.id,
                role: "compactionSummary",
                summary: parsed.summary ?? "",
                tokensBefore: parsed.tokensBefore,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (!managed && parsed.type === "message" && parsed.message) {
              if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id as string)) continue;
              messages.push(parsed.message);
            }
          } catch {}
        }
        rl.close();
      } catch (err) {
        log.warn("Failed to read entries from JSONL", { err: err instanceof Error ? err.message : String(err) });
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
    await managed.client.setThinkingLevel(level as Parameters<typeof managed.client.setThinkingLevel>[0]).catch(() => {});
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
    return managed.client.getSettings(scope as "global" | "project" | undefined).catch(() => ({}));
  }

  async setSettings(sessionId: string, settings: Record<string, unknown>, scope?: string): Promise<void> {
    const managed = this.clients.get(sessionId);
    if (!managed) return;
    await managed.client.setSettings(settings, scope as "global" | "project" | undefined).catch(() => {});
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

  async fork(sessionId: string, entryId: string, options?: { position?: "before" | "at" }): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    const result = await managed.client.fork(entryId, options);
    if (!result.cancelled) {
      this.stop(sessionId);
    }
    return result;
  }

  async navigateTree(sessionId: string, targetId: string, options?: { summarize?: boolean; skipFiles?: boolean }): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (managed) {
      return managed.client.navigateTree(targetId, options);
    }
    this.leafIds.set(sessionId, targetId === "null" || targetId === null ? null : targetId);
    return { cancelled: false };
  }

  async previewRollback(sessionId: string, targetId: string): Promise<{ restored: string[]; deleted: string[] }> {
    const managed = this.clients.get(sessionId);
    if (managed) {
      return managed.client.previewRollback(targetId);
    }
    return { restored: [], deleted: [] };
  }

  async getTree(sessionId: string): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (managed) {
      try {
        return await managed.client.getTree();
      } catch {}
    }
    const sessionPath = this.resolveSessionPath(sessionId);
    if (!sessionPath) throw new Error("Client not found and no session path");
    const entries = await this.readJsonlEntries(sessionPath);
    return {
      entries: entries.map((e) => ({
        id: e.id,
        parentId: e.parentId,
        type: e.type,
        label: e.type === "message" ? undefined : e.customType,
      })),
      leafId: this.leafIds.get(sessionId) ?? null,
    };
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

  async callChannel(sessionId: string, channelName: string, method: string, params: Record<string, unknown>): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) throw new Error("Client not found");
    const ch = managed.client.channel(channelName);
    return ch.call(method, params);
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
      if (ch.name === "memory") {
        this.handleMemoryChannelData(sessionId, ch);
        return;
      }
    }

    if (event.type === "extension_ui_request") {
      const ui = event as ExtensionUIRequestEvent;
      const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
      if (ui.method === "notify") {
        this.broadcastEvent("agent.notify", {
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
    const sessionPath = managed?.info.sessionPath ?? "";

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

    await this.broadcastEvent(
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

    await this.broadcastEvent(
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

    await this.broadcastEvent(
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

    if (data.event === "startup_complete" || data.event === "status_changed") {
      const servers = (data.servers ?? []) as Array<{ state?: string; status?: { state?: string } }>;
      const cached = this.lastLspState.get(sessionId);
      this.lastLspState.set(sessionId, {
        state: servers.some((s) => s.state === "ready" || s.status?.state === "ready") ? "ready"
          : servers.some((s) => s.state === "error" || s.status?.state === "error") ? "error"
          : servers.length > 0 ? "starting" : "inactive",
        servers: data.servers ?? [],
        activeLanguages: cached?.activeLanguages ?? [],
      });
    }
    if (data.event === "mode_changed" && data.mode) {
      const cached = this.lastLspState.get(sessionId);
      if (cached) cached.mode = data.mode;
    }
    if (data.event === "language_activated" && data.languages?.length) {
      const cached = this.lastLspState.get(sessionId);
      if (cached) {
        cached.activeLanguages = Array.from(new Set([...(cached.activeLanguages ?? []), ...data.languages]));
      }
    }

    await this.broadcastEvent(
      "lsp.event",
      { sessionId, event: data },
      { sessionId },
    );
  }

  private async handleRulesChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as RulesChannelEvent;
    if (!data) return;

    log.info("Rules channel data", { sessionId, type: data.type });

    await this.broadcastEvent(
      "rules.event",
      { sessionId, event: data },
      { sessionId },
    );
  }

  private async handleMemoryChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    const eventType = data.type as string;
    log.info("Memory channel data", { sessionId, type: eventType });

    if (eventType === "bookmark_creating") {
      await this.broadcastEvent("memory.bookmark_creating", { sessionId, timestamp: Date.now() }, { sessionId });
    } else if (eventType === "memory_updated") {
      await this.broadcastEvent("memory.updated", { sessionId, files: data.files, timestamp: Date.now() }, { sessionId });
    } else if (eventType === "memory_update_failed") {
      await this.broadcastEvent("memory.update_failed", { sessionId, reason: data.reason, timestamp: Date.now() }, { sessionId });
    } else if (eventType === "memory_prefetch" || eventType === "memory_extract" || eventType === "memory_dream") {
      await this.broadcastEvent(`memory.${eventType}`, { sessionId, ...data, timestamp: Date.now() }, { sessionId });
    } else if (eventType === "memory_prefetch_result" || eventType === "memory_extract_result" || eventType === "memory_dream_result") {
      await this.broadcastEvent(`memory.${eventType}`, { sessionId, ...data, timestamp: Date.now() }, { sessionId });
    }
  }

  private async emitAgentEvent(sessionId: string, event: SanitizedEvent): Promise<void> {
    await this.broadcastEvent(
      "agent.event",
      { sessionId, event },
      { sessionId },
    );
  }

  async sendChannelMessage(sessionId: string, channelName: string, data: unknown): Promise<unknown> {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;
    try {
      const ch = managed.client.channel(channelName);
      return await ch.invoke(data);
    } catch (err) {
      log.warn("sendChannelMessage failed", { sessionId, channelName, err: (err as Error).message });
      return null;
    }
  }

  hasSession(sessionId: string): boolean {
    const managed = this.clients.get(sessionId);
    return managed !== undefined;
  }

  getProjectPath(sessionId: string): string | undefined {
    const managed = this.clients.get(sessionId);
    return managed?.info?.projectPath;
  }

  getCachedLspState(sessionId: string): { state: string; servers: unknown[]; mode?: string } | undefined {
    return this.lastLspState.get(sessionId);
  }
}
