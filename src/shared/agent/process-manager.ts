import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { createReadStream } from "fs";

import * as os from "os";
import * as path from "path";
import * as readline from "readline";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  AgentMessageForUI,
  ChannelDataEvent,
  ExtensionUIRequestEvent,
} from "../modules/agent";
import type { AssistantMessage, AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { TodoChannelEvent } from "../modules/todo";
import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";
import type { RulesChannelEvent } from "../modules/rules";
import type { RpcClientAPI, TreeEntry, ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";
import { performance } from "perf_hooks";

// 沙箱模式
import { SandboxManager } from "../../sandbox/sandbox-manager";
import { SandboxBoxProvider } from "../../sandbox/providers/sandbox-box";
import type { ISandboxProvider } from "../../sandbox/types";
import { SandboxRpcClient } from "../../sandbox/sandbox-rpc-client";

type McpServerInfo = Awaited<ReturnType<RpcClientAPI["getMcpServers"]>>[number];

type ChannelMethodKeys<CN extends keyof ChannelTypeRegistry> = keyof NonNullable<
  ChannelTypeRegistry[CN]["methods"]
> &
  string;

type ChannelMethodParams<
  CN extends keyof ChannelTypeRegistry,
  MN extends ChannelMethodKeys<CN>,
> = NonNullable<ChannelTypeRegistry[CN]["methods"]>[MN] extends { params: infer P } ? P : unknown;

type ChannelMethodReturn<
  CN extends keyof ChannelTypeRegistry,
  MN extends ChannelMethodKeys<CN>,
> = NonNullable<ChannelTypeRegistry[CN]["methods"]>[MN] extends { return: infer R } ? R : unknown;
import type { CoordinatorMethodCall, CoordinatorChannelEvent } from "../modules/coordinator";
import { createLogger } from "../lib/logger";
import { config } from "../../server-config";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

/**
 * Race a promise against a timeout. Rejects with a descriptive error if the
 * promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

/**
 * Strip parentSession from a JSONL session file's header entry.
 * Prevents forked sessions from being identified as subagent children on refresh.
 */
function stripParentSessionFromHeader(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    const newlineIdx = content.indexOf("\n");
    if (newlineIdx < 0) return;
    const firstLine = content.slice(0, newlineIdx);
    const rest = content.slice(newlineIdx + 1);
    const header = JSON.parse(firstLine) as Record<string, unknown>;
    if ("parentSession" in header) {
      delete header.parentSession;
      writeFileSync(filePath, JSON.stringify(header) + "\n" + rest, "utf-8");
    }
  } catch (err) {
    log.warn("stripParentSessionFromHeader failed", {
      filePath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Scan the global extensions directory (~/.pi/agent/extensions/) and
 * return `--extension <path>` args for each discovered entry.
 *
 * Layout: each subdirectory with an index.ts/js, or each .ts/.js file,
 * is treated as an extension. Symlinks are resolved.
 */
function discoverExtensionArgs(): string[] {
  const extDir = config.piExtensionsDir;
  if (!existsSync(extDir)) {
    log.warn("Global extensions directory not found", { extDir });
    return [];
  }

  const extensionPaths: string[] = [];
  try {
    for (const entry of readdirSync(extDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(path.join(extDir, entry.name));
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      const fullPath = path.join(extDir, entry.name);
      if (isDir) {
        const indexTs = path.join(fullPath, "index.ts");
        const indexJs = path.join(fullPath, "index.js");
        if (existsSync(indexTs)) {
          extensionPaths.push(indexTs);
        } else if (existsSync(indexJs)) {
          extensionPaths.push(indexJs);
        }
      } else if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        extensionPaths.push(fullPath);
      }
    }
  } catch (err: unknown) {
    log.warn("Failed to scan extensions directory", {
      extDir,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("Discovered extensions", { extDir, count: extensionPaths.length });
  for (const p of extensionPaths) {
    log.info("  → extension:", { path: p });
  }
  return extensionPaths.flatMap((p) => ["--extension", p]);
}

const EXTENSION_ARGS = ["--no-extensions", ...discoverExtensionArgs()];

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

function sanitizeEvent(event: AgentEvent): SanitizedEvent {
  if (event.type === "message_update") {
    const { assistantMessageEvent, ...rest } = event;
    const { partial: _, ...ameRest } = assistantMessageEvent as AssistantMessageEvent & {
      partial?: AssistantMessage;
    };
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
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
}

import type { AgentProcessInfo } from "../modules/agent";

let cachedModule: { RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI } | null =
  null;

// 全局沙箱管理器（在 sandbox 模式下初始化）
let globalSandboxManager: SandboxManager | null = null;

export function initSandboxManager(projectsRoot: string): SandboxManager {
  let provider: ISandboxProvider;
  const providerType = config.sandboxProvider ?? "local";

  if (providerType === "sandbox-box") {
    provider = new SandboxBoxProvider({
      sshHost: config.sandboxBoxSshHost ?? "192.168.0.29",
      sshPort: config.sandboxBoxSshPort ?? 2201,
      sshUser: config.sandboxBoxSshUser ?? "root",
      sshKeyPath: config.sandboxBoxSshKey ?? "~/.ssh/id_rsa",
      sandboxPort: 3200,
      bridgePort: 3101,
      baseLocalPort: config.sandboxBasePort,
      piCliPath: config.piCliPath,
      projectSourcePath: projectsRoot,
      modelsJsonPath: config.sandboxBoxModelsJson,
      settingsJsonPath: config.sandboxBoxSettingsJson,
      extensionsPath: config.sandboxBoxExtensionsPath,
    });
  } else {
    throw new Error(`Unknown sandbox provider: ${providerType}. Only "sandbox-box" is supported.`);
  }

  globalSandboxManager = new SandboxManager(provider, {
    idleTimeoutMs: (config.sandboxIdleTimeout ?? 1800) * 1000,
    gcIntervalMs: 60_000,
  });

  if (providerType === "sandbox-box" && provider instanceof SandboxBoxProvider) {
    provider.cleanupStaleSandboxes([]).catch((err) => {
      log.warn("startup sandbox cleanup failed (non-fatal)", { error: String(err) });
    });
  }

  return globalSandboxManager;
}

export function getSandboxEndpoint(userId: string): string | null {
  if (!globalSandboxManager) return null;
  const endpoint = (
    globalSandboxManager as { getEndpoint(userId: string): string | undefined }
  ).getEndpoint(userId);
  return endpoint ?? null;
}

export function getSandboxManager(): SandboxManager | null {
  return globalSandboxManager;
}

async function createRpcClient(
  cliPath: string,
  cwd: string,
  sessionPath: string | undefined,
  userId?: string,
): Promise<{ client: RpcClientInstance; timings: { dynamicImport: number; construct: number } }> {
  const t0 = performance.now();

  // 沙箱模式：通过 SandboxRpcClient 转发到沙箱容器
  if (config.sandboxEnabled && globalSandboxManager && userId) {
    const sandbox = await globalSandboxManager.getOrCreate(userId);
    const client = new SandboxRpcClient(sandbox.endpoint) as unknown as RpcClientInstance;
    const t1 = performance.now();
    const timings = { dynamicImport: Math.round(t1 - t0), construct: 0 };
    perfLog.info("[createRpcClient] sandbox mode", { userId, endpoint: sandbox.endpoint });
    return { client, timings };
  }

  cachedModule ??= (await import("@dyyz1993/pi-coding-agent")) as unknown as {
    RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI;
  };
  const t1 = performance.now();

  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

  const args = [...EXTENSION_ARGS];
  if (sessionPath && existsSync(sessionPath)) {
    args.push("--session", sessionPath);
  }

  const client = new cachedModule.RpcClient({
    cliPath,
    cwd,
    args,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" },
  });
  await client.start();
  const t2 = performance.now();

  const timings = {
    dynamicImport: Math.round(t1 - t0),
    construct: Math.round(t2 - t1),
    start: Math.round(t2 - t1),
  };
  perfLog.info("[createRpcClient] done", timings);

  return { client, timings };
}

export class AgentProcessManager {
  private clients = new Map<string, ManagedClient>();
  /** CWD-based process tracking: projectPath → set of ManagedClients for that project */
  private processByCwd = new Map<string, Set<ManagedClient>>();
  private servers = new Set<RPCServer>();
  /** Guard: prevents recursive start() via coordinator session_delegate */
  private _startInProgress = false;
  /** Queued delegate requests received during start() */
  private _pendingDelegateRequests: Array<{
    sessionId: string;
    msg: unknown;
    channelName: string;
    resolve: (result: unknown) => void;
  }> = [];
  private sessionPaths = new Map<string, string>();
  /** Persistent projectPath per session — NOT cleaned on stop(), only on service restart.
      Allows restarting an inactive session when receiving delegate messages. */
  private sessionProjectPaths = new Map<string, string>();
  private leafIds = new Map<string, string | null>();
  private lastLspState = new Map<
    string,
    { state: string; servers: unknown[]; mode?: string; activeLanguages?: string[] }
  >();
  private parentChildMap = new Map<string, Set<string>>();
  private delegateReplyCount = new Map<string, number>();
  private delegateCreatedAt = new Map<string, number>();
  private syncDelegateResolvers = new Map<
    string,
    {
      resolve: (result: {
        sessionId: string;
        status: string;
        exitCode: number;
        finalText: string;
        error?: string;
      }) => void;
      timeout: ReturnType<typeof setTimeout>;
      parentSessionId: string;
    }
  >();
  private subagentSyncChildren = new Set<string>();
  private syncDelegateLastText = new Map<string, string>();

  private static MAX_POOL_SIZE = 5;

  private addToPool(poolKey: string, managed: ManagedClient): void {
    let pool = this.processByCwd.get(poolKey);
    if (!pool) {
      pool = new Set();
      this.processByCwd.set(poolKey, pool);
    }
    pool.add(managed);
  }

  private removeFromPool(poolKey: string, managed: ManagedClient): void {
    const pool = this.processByCwd.get(poolKey);
    if (pool) {
      pool.delete(managed);
      if (pool.size === 0) {
        this.processByCwd.delete(poolKey);
      }
    }
  }

  private evictLRU(poolKey: string): void {
    const pool = this.processByCwd.get(poolKey);
    if (!pool || pool.size < AgentProcessManager.MAX_POOL_SIZE) return;

    let oldest: ManagedClient | null = null;
    for (const mc of pool) {
      if (mc.info.status === "streaming") continue;
      if (mc.activeBackgroundTools.size > 0) continue;
      if (!oldest || mc.lastActiveAt < oldest.lastActiveAt) {
        oldest = mc;
      }
    }

    if (oldest) {
      const sid = oldest._activeSessionId;
      log.info("[evictLRU] evicting idle process", { poolKey, sessionId: sid });
      oldest.unsubscribe();
      oldest.client.stop().catch(() => {});
      this.clients.delete(sid);
      pool.delete(oldest);
      if (pool.size === 0) {
        this.processByCwd.delete(poolKey);
      }
    }
  }

  private getPoolKey(projectPath: string, userId?: string): string {
    return config.sandboxEnabled && userId ? `${projectPath}::${userId}` : projectPath;
  }

  private sessionMsgCache = new Map<
    string,
    {
      messages: Array<{ entryId: string; message: unknown }>;
      customEntries: Array<{
        id: string;
        customType: string;
        data: unknown;
        timestamp: number;
      }>;
      parentById: Map<string, string | null>;
      fileSize: number;
      mtimeMs: number;
      lineCount: number;
    }
  >();
  private static SESSION_CACHE_MAX = 10;

  /**
   * Get cached session data. Three outcomes:
   * 1. Exact match (file unchanged) → return cached data
   * 2. File grew → return cached data + mark for incremental append
   * 3. No cache / file shrunk / file gone → return null
   */
  private getSessionCache(
    sessionId: string,
    sessionPath: string,
  ): {
    messages: Array<{ entryId: string; message: unknown }>;
    customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }>;
    parentById: Map<string, string | null>;
    lineCount: number;
    needsIncremental: boolean;
  } | null {
    const cached = this.sessionMsgCache.get(sessionId);
    if (!cached) return null;
    try {
      const st = statSync(sessionPath);
      if (st.size === cached.fileSize && st.mtimeMs === cached.mtimeMs) {
        // Exact match — file unchanged
        this.sessionMsgCache.delete(sessionId);
        this.sessionMsgCache.set(sessionId, cached);
        return { ...cached, needsIncremental: false };
      }
      if (st.size > cached.fileSize) {
        // File grew — can do incremental append
        this.sessionMsgCache.delete(sessionId);
        this.sessionMsgCache.set(sessionId, cached);
        return { ...cached, needsIncremental: true };
      }
      // File shrunk or changed drastically — invalidate
    } catch {
      // file gone or inaccessible
    }
    this.sessionMsgCache.delete(sessionId);
    return null;
  }

  private setSessionCache(
    sessionId: string,
    sessionPath: string,
    data: {
      messages: Array<{ entryId: string; message: unknown }>;
      customEntries: Array<{
        id: string;
        customType: string;
        data: unknown;
        timestamp: number;
      }>;
      parentById: Map<string, string | null>;
      lineCount: number;
    },
  ): void {
    try {
      const st = statSync(sessionPath);
      if (this.sessionMsgCache.size >= AgentProcessManager.SESSION_CACHE_MAX) {
        const oldest = this.sessionMsgCache.keys().next().value;
        if (oldest) this.sessionMsgCache.delete(oldest);
      }
      this.sessionMsgCache.set(sessionId, {
        ...data,
        fileSize: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // file gone — don't cache
    }
  }

  clearSessionCache(sessionId?: string): void {
    if (sessionId) {
      this.sessionMsgCache.delete(sessionId);
    } else {
      this.sessionMsgCache.clear();
    }
  }

  /**
   * Read JSONL from a specific physical line number onwards and append results.
   * Returns { newEntries: number of new parsed entries, totalLines: total physical lines in file }
   */
  private async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{ newEntries: number; totalLines: number }> {
    let lineIndex = 0;
    let newEntries = 0;
    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lineIndex++;
      if (lineIndex <= startLine) continue; // skip already-parsed lines
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const entryId = (parsed.id as string) ?? "";
        const parentId = (parsed.parentId as string | null | undefined) ?? null;
        if (entryId) {
          parentById.set(entryId, parentId);
        }
        if (parsed.type === "message" && parsed.message) {
          messages.push({ entryId, message: parsed.message });
          newEntries++;
        } else if (parsed.type === "custom") {
          customEntries.push({
            id: entryId || `custom-${Date.now()}`,
            customType: (parsed.customType as string) ?? "unknown",
            data: parsed.data,
            timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
          });
          newEntries++;
        }
      } catch {
        // skip malformed
      }
    }
    rl.close();
    return { newEntries, totalLines: lineIndex };
  }

  private async _drainPendingDelegates(): Promise<void> {
    while (this._pendingDelegateRequests.length > 0) {
      const item = this._pendingDelegateRequests.shift();
      if (!item) break;
      const { sessionId, msg, resolve } = item;
      try {
        const call = msg as CoordinatorMethodCall;
        let delegateResult: unknown;
        if (call.__call === "session_delegate_sync") {
          delegateResult = await this.handleCoordinatorDelegateSync(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
          );
        } else {
          delegateResult = await this.handleCoordinatorDelegate(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
          );
        }
        resolve(delegateResult);
      } catch (err: unknown) {
        resolve({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  private findParentSession(childSessionId: string): string | null {
    for (const [parentId, children] of this.parentChildMap.entries()) {
      if (children.has(childSessionId)) return parentId;
    }
    return null;
  }

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

  private async broadcastEvent(
    eventType: string,
    payload: unknown,
    metadata?: unknown,
  ): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.emitEvent(eventType, payload, metadata);
      } catch (err: unknown) {
        log.warn("broadcastEvent failed, removing server", {
          eventType,
          err: err instanceof Error ? err.message : String(err),
        });
        this.servers.delete(server);
      }
    }
  }

  private broadcastSessionStatus(sessionId: string, status: string): void {
    const managed = this.getActiveManaged(sessionId);
    const projectPath = managed?.info.projectPath ?? "";
    this.broadcastEvent(
      "agent.session_status_changed",
      { sessionId, projectPath, status },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(session.status_changed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async start(
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: { forceNewProcess?: boolean; userId?: string },
  ): Promise<{ agentId: string; status: "started" | "already_running" }> {
    const tStart = performance.now();

    if (this._startInProgress) {
      log.warn("[start] reentrant call blocked", { sessionId });
      return { agentId: sessionId, status: "already_running" };
    }
    this._startInProgress = true;

    const existing = this.clients.get(sessionId);
    if (existing && existing._activeSessionId === sessionId) {
      perfLog.info("[start] already_running (cached hit)", {
        sessionId,
        totalMs: Math.round(performance.now() - tStart),
      });
      existing.lastActiveAt = Date.now();
      this._startInProgress = false;
      this._drainPendingDelegates();
      return { agentId: sessionId, status: "already_running" };
    }

    const poolKey = this.getPoolKey(projectPath, options?.userId);

    perfLog.info("[start] begin (new process)", { sessionId, projectPath });

    this.evictLRU(poolKey);

    const { client, timings: createTimings } = await createRpcClient(
      config.piCliPath,
      projectPath,
      sessionPath,
      config.sandboxEnabled ? (options?.userId ?? sessionId) : undefined,
    );
    const tAfterCreate = performance.now();

    log.info("Spawning pi via RpcClient", { cwd: projectPath, sessionPath });

    const info: AgentProcessInfo = {
      sessionId,
      projectPath,
      sessionPath,
      status: "idle",
      holdEvents: [],
    };

    const managed: ManagedClient = {
      client,
      info,
      unsubscribe: () => {},
      _activeSessionId: sessionId,
      lastActiveAt: Date.now(),
      activeBackgroundTools: new Set(),
    };

    const bridge = (event: unknown): void => {
      this.handleEvent(managed._activeSessionId, event as AgentEvent);
    };
    try {
      managed.unsubscribe = client.onEvent(bridge);
    } catch {
      managed.unsubscribe = () => {};
    }

    const coordinatorChannelNames = new Set(["coordinator", "coordinator_client"]);
    const channelNames = [
      "bash",
      "todo",
      "subagent",
      "lsp",
      "rules-engine",
      "memory",
      "coordinator",
      "coordinator_client",
      "supervisor",
      "file-snapshot",
      "file-review",
    ] as const;
    for (const name of channelNames) {
      try {
        client.channel(name).onReceive((data: unknown) => {
          if (coordinatorChannelNames.has(name)) {
            this.handleCoordinatorCall(managed._activeSessionId, data, name);
            return;
          }
          this.handleEvent(managed._activeSessionId, {
            type: "channel_data",
            name,
            data,
          } as ChannelDataEvent);
        });
      } catch {
        // sandbox mode: channels not supported, skip
      }
    }

    const processStartMs = Math.round(performance.now() - tAfterCreate);
    perfLog.info("[start] RpcClient ready", {
      sessionId,
      totalMs: Math.round(performance.now() - tStart),
      dynamicImportMs: createTimings.dynamicImport,
      constructMs: createTimings.construct,
      createRpcTotalMs: Math.round(tAfterCreate - tStart),
      processStartMs,
      channelsRegistered: channelNames.length,
    });

    log.info("RpcClient started", { sessionId });
    this.sessionPaths.set(sessionId, sessionPath);
    this.sessionProjectPaths.set(sessionId, projectPath);
    this.clients.set(sessionId, managed);
    this.addToPool(poolKey, managed);
    this._startInProgress = false;
    this._drainPendingDelegates();
    this.broadcastSessionStatus(sessionId, "idle");
    return { agentId: sessionId, status: "started" };
  }

  async replayHoldEvents(sessionId: string): Promise<{ replayed: number }> {
    const t0 = performance.now();
    const managed = this.getActiveManaged(sessionId);
    if (!managed) {
      perfLog.info("[replayHoldEvents] no client", { sessionId, totalMs: 0 });
      return { replayed: 0 };
    }
    const events = managed.info.holdEvents;
    for (const evt of events) {
      await this.emitAgentEvent(sessionId, evt as SanitizedEvent);
    }
    const totalMs = Math.round(performance.now() - t0);
    perfLog.info("[replayHoldEvents] done", { sessionId, replayed: events.length, totalMs });
    return { replayed: events.length };
  }

  async send(
    sessionId: string,
    content: string,
    images?: import("@dyyz1993/pi-ai").ImageContent[],
  ): Promise<boolean> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) {
      log.warn("send: no client after ensure", { sessionId });
      return false;
    }
    managed.lastActiveAt = Date.now();
    managed.client.prompt(content, images).catch(async (err: Error) => {
      log.warn("prompt error", { err: err.message });
      if (!(await this.isClientAlive(sessionId, managed!))) {
        this.cleanupDeadClient(sessionId, `prompt failed: ${err.message}`);
        return;
      }
      this.emitAgentEvent(sessionId, { type: "agent_end" } as SanitizedEvent).catch(
        (emitErr: unknown) => {
          log.warn("emitAgentEvent(agent_end) after prompt error", {
            err: emitErr instanceof Error ? emitErr.message : String(emitErr),
          });
        },
      );
    });
    return true;
  }

  steer(
    sessionId: string,
    content: string,
    images?: import("@dyyz1993/pi-ai").ImageContent[],
  ): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    managed.client.steer(content, images).catch((err: unknown) => {
      log.warn("steer error", { sessionId, err: err instanceof Error ? err.message : String(err) });
    });
    return true;
  }

  followUp(
    sessionId: string,
    content: string,
    images?: import("@dyyz1993/pi-ai").ImageContent[],
  ): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    managed.client.followUp(content, images).catch((err: unknown) => {
      log.warn("followUp error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return true;
  }

  async abort(sessionId: string): Promise<boolean> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    await managed.client.abort().catch((err: unknown) => {
      log.warn("abort error", { sessionId, err: err instanceof Error ? err.message : String(err) });
    });
    this.emitAgentEvent(sessionId, { type: "agent_end" } as SanitizedEvent).catch(
      (err: unknown) => {
        log.warn("emitAgentEvent(agent_end) after abort error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return true;
  }

  async setCwd(sessionId: string, cwd: string): Promise<boolean> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    await managed.client.setCwd(cwd).catch((err: unknown) => {
      log.warn("setCwd error", {
        sessionId,
        cwd,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;

    managed.client.respondUI(requestId, response);
    return true;
  }

  stop(sessionId: string, crashReason?: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;

    managed.info.status = "idle";
    const endEvent = crashReason
      ? ({ type: "agent_end", reason: crashReason } as unknown as SanitizedEvent)
      : ({ type: "agent_end" } as SanitizedEvent);
    this.emitAgentEvent(sessionId, endEvent).catch((err: unknown) => {
      log.warn("emitAgentEvent(agent_end) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    // Cascade stop delegated children
    const children = this.parentChildMap.get(sessionId);
    if (children) {
      for (const childId of children) {
        this.stop(childId);
      }
      this.parentChildMap.delete(sessionId);
      this.delegateReplyCount.delete(sessionId);
      this.delegateCreatedAt.delete(sessionId);
    }

    // Remove from parent's children set if this is a delegated session
    for (const [, childSet] of this.parentChildMap) {
      childSet.delete(sessionId);
    }

    this.delegateReplyCount.delete(sessionId);
    this.delegateCreatedAt.delete(sessionId);

    const syncResolver = this.syncDelegateResolvers.get(sessionId);
    if (syncResolver) {
      clearTimeout(syncResolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      this.syncDelegateLastText.delete(sessionId);
      syncResolver.resolve({
        sessionId,
        status: "aborted",
        exitCode: 1,
        finalText: "(stopped)",
      });
    }

    managed.unsubscribe();
    managed.client.stop().catch((err: unknown) => {
      log.warn("stop error", { sessionId, err: err instanceof Error ? err.message : String(err) });
    });
    this.clients.delete(sessionId);
    const poolKey = this.getPoolKey(managed.info.projectPath);
    this.removeFromPool(poolKey, managed);
    const sandboxKey = this.getPoolKey(managed.info.projectPath, managed._activeSessionId);
    if (sandboxKey !== poolKey) {
      this.removeFromPool(sandboxKey, managed);
    }
    // Note: sessionPaths, sessionProjectPaths, and leafIds are NOT cleared here.
    // They persist for session restart support (coordinator delegate_send)
    // and JSONL fallback navigateTree (rollback without active CLI process).
    // When the CLI restarts, getTreeWithLeaf() will overwrite with the
    // authoritative value, so stale data self-heals.
    this.lastLspState.delete(sessionId);
    this.clearSessionCache(sessionId);
    return true;
  }

  getStatus(sessionId: string): { status: "idle" | "streaming" | "stopped"; pid?: number } {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { status: "stopped" };
    return { status: managed.info.status };
  }

  batchGetSessionsStatus(
    sessionIds: string[],
  ): Array<{ sessionId: string; status: "idle" | "streaming" | "stopped" }> {
    return sessionIds.map((sid) => {
      const managed = this.getActiveManaged(sid);
      return { sessionId: sid, status: managed?.info.status ?? "stopped" };
    });
  }

  private async readJsonlEntries(sessionPath: string): Promise<
    Array<{
      id: string;
      parentId: string | null;
      type: string;
      customType?: string;
      label?: string;
    }>
  > {
    const entries: Array<{
      id: string;
      parentId: string | null;
      type: string;
      customType?: string;
      label?: string;
    }> = [];
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
            let label: string | undefined;
            if (
              parsed.type === "message" &&
              parsed.message &&
              typeof parsed.message === "object" &&
              parsed.message !== null
            ) {
              label = (parsed.message as Record<string, unknown>).role as string | undefined;
            } else if (parsed.customType) {
              label = parsed.customType as string;
            }
            entries.push({
              id: parsed.id as string,
              parentId: (parsed.parentId as string | null | undefined) ?? null,
              type: parsed.type as string,
              customType: parsed.customType as string | undefined,
              label,
            });
          }
        } catch (err: unknown) {
          log.warn("readJsonlEntries: skipping malformed entry", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      rl.close();
    } catch (err: unknown) {
      log.warn("readJsonlEntries: failed to read file", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return entries;
  }

  /**
   * Get the managed client for a session.
   * Each session now has its own dedicated CLI process.
   */
  private getActiveManaged(sessionId: string): ManagedClient | null {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;
    if (managed._activeSessionId === sessionId) return managed;
    this.clients.delete(sessionId);
    return null;
  }

  /**
   * Ensure a managed client exists for the session.
   * In sandbox mode, if the managed client was GC'd, this will rebuild it
   * by calling start() with the persisted session/project metadata.
   */
  private async ensureManagedClient(sessionId: string): Promise<ManagedClient | null> {
    const existing = this.getActiveManaged(sessionId);
    if (existing) return existing;

    if (!config.sandboxEnabled) return null;

    const projectPath = this.sessionProjectPaths.get(sessionId);
    const sessionPath = this.sessionPaths.get(sessionId);
    if (!projectPath || !sessionPath) {
      log.warn("[ensureManagedClient] no persisted session metadata", { sessionId });
      return null;
    }

    const userId = this._getSandboxUserId(sessionId) ?? sessionId;

    log.info("[ensureManagedClient] rebuilding GC'd sandbox", { sessionId, projectPath, userId });

    try {
      const result = await this.start(sessionId, projectPath, sessionPath, {
        forceNewProcess: false,
        userId,
      });
      log.info("[ensureManagedClient] rebuild complete", { sessionId, status: result.status });
    } catch (err: unknown) {
      log.error("[ensureManagedClient] rebuild failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    return this.getActiveManaged(sessionId);
  }

  private _getSandboxUserId(sessionId: string): string | null {
    if (!config.sandboxEnabled) return null;
    for (const [key, pool] of this.processByCwd) {
      for (const mc of pool) {
        if (mc._activeSessionId === sessionId && key.includes("::")) {
          return key.split("::")[1] ?? null;
        }
      }
    }
    for (const [, mc] of this.clients) {
      if (mc._activeSessionId === sessionId) {
        const projectPath = mc.info.projectPath;
        for (const [key] of this.processByCwd) {
          if (key.startsWith(`${projectPath}::`)) {
            return key.split("::")[1] ?? null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Check if a managed client's CLI process is still alive.
   * Uses a lightweight getState() probe — if it fails, the CLI likely OOM'd or crashed.
   */
  private async isClientAlive(sessionId: string, managed: ManagedClient): Promise<boolean> {
    try {
      // getState is cheap (scalar properties only, no serialization of messages)
      await withTimeout(managed.client.getState(), 10_000, "getState");
      return true;
    } catch (probeErr: unknown) {
      log.warn("CLI health check failed, process likely dead", {
        sessionId,
        probeErr: probeErr instanceof Error ? probeErr.message : String(probeErr),
      });
      return false;
    }
  }

  /**
   * Clean up a dead CLI client. Called when an RPC call fails and the CLI
   * process is confirmed dead (OOM, crash, killed).
   */
  private cleanupDeadClient(sessionId: string, reason: string): void {
    log.warn("[cleanupDeadClient] CLI process is dead, cleaning up", { sessionId, reason });
    const shortReason = reason.includes("heap limit")
      ? "Out of memory (OOM)"
      : reason.includes("prompt failed")
        ? "Agent process crashed"
        : "Agent process died";
    this.stop(sessionId, shortReason);
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
    model?: {
      id: string;
      name?: string;
      provider?: string;
      reasoning?: boolean;
      contextWindow: number;
      maxTokens: number;
    };
    thinkingLevel?: string;
    isStreaming: boolean;
    isCompacting: boolean;
    messageCount: number;
  } | null> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return null;

    try {
      const state = await withTimeout(managed.client.getState(), 10_000, "getState");
      const model = state.model;
      return {
        model: model
          ? {
              id: String(model.id ?? ""),
              name: model.name ? String(model.name) : undefined,
              provider: model.provider ? String(model.provider) : undefined,
              reasoning: Boolean(model.reasoning),
              contextWindow: Number(model.contextWindow ?? 0),
              maxTokens: Number(model.maxTokens ?? 0),
            }
          : undefined,
        thinkingLevel: state.thinkingLevel ? String(state.thinkingLevel) : undefined,
        isStreaming: Boolean(state.isStreaming),
        isCompacting: Boolean(state.isCompacting),
        messageCount: Number(state.messageCount ?? 0),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getState RPC failed, checking if CLI is alive", { sessionId, error: msg });
      if (!(await this.isClientAlive(sessionId, managed))) {
        this.cleanupDeadClient(sessionId, `getState failed: ${msg}`);
      }
      return null;
    }
  }

  async getCommands(
    sessionId: string,
  ): Promise<
    Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>
  > {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return [];

    try {
      const commands = await withTimeout(managed.client.getCommands(), 10_000, "getCommands");
      if (!commands) return [];
      return commands.map((c) => ({
        name: String(c.name ?? ""),
        description: String(c.description ?? ""),
        source: (c.source as "extension" | "prompt" | "skill") ?? "extension",
      }));
    } catch (err: unknown) {
      log.warn("getCommands failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async getSessionStats(sessionId: string): Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;

    try {
      const stats = await withTimeout(managed.client.getSessionStats(), 10_000, "getSessionStats");
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
        contextUsage: cu
          ? {
              tokens: cu.tokens,
              contextWindow: Number(cu.contextWindow ?? 0),
              percent: cu.percent,
            }
          : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getSessionStats failed, checking if CLI is alive", {
        sessionId,
        err: msg,
      });
      if (!(await this.isClientAlive(sessionId, managed))) {
        this.cleanupDeadClient(sessionId, `getSessionStats failed: ${msg}`);
      }
      return null;
    }
  }

  async getMessages(
    sessionId: string,
    sessionPath?: string,
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }> {
    const managed = this.getActiveManaged(sessionId);

    let messages: unknown[] = [];
    let resolvedSessionPath = sessionPath ?? "";
    let activePathIds: Set<string> | null = null;

    if (managed) {
      resolvedSessionPath = managed.info.sessionPath;
      try {
        const messagesResult = await withTimeout(
          managed.client.getMessages(),
          15_000,
          "getMessages",
        );
        if (messagesResult) {
          messages = messagesResult;
        }
      } catch (err: unknown) {
        log.warn("getMessages SDK failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const treeResult = await withTimeout(
          managed.client.getTreeWithLeaf(),
          10_000,
          "getTreeWithLeaf",
        );
        const entries = treeResult.entries;
        const leafId = treeResult.leafId;
        if (leafId) {
          this.leafIds.set(sessionId, leafId);
        }
        if (Array.isArray(entries) && leafId) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; label?: string }
          >();
          for (const e of entries) {
            byId.set(e.id, e);
          }
          activePathIds = new Set<string>();
          let curId: string | null | undefined = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId =
              node && typeof node.parentId === "string" && node.parentId
                ? node.parentId
                : undefined;
          }
        }
      } catch (err: unknown) {
        log.warn("getTreeWithLeaf failed in getMessages", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      resolvedSessionPath = this.resolveSessionPath(sessionId) ?? sessionPath ?? "";
      const leafId = this.leafIds.get(sessionId) ?? null;
      if (resolvedSessionPath && leafId !== undefined) {
        const jsonlEntries = await this.readJsonlEntries(resolvedSessionPath);
        if (jsonlEntries.length > 0 && leafId !== null) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; customType?: string }
          >();
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

    const customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];
    const isSandboxSessionPath = resolvedSessionPath?.startsWith("/root/workspace/sessions/");

    if (isSandboxSessionPath && globalSandboxManager && !managed) {
      try {
        const userId = this._getSandboxUserId(sessionId);
        if (userId) {
          const raw = await globalSandboxManager.execInSandbox(
            userId,
            `cat ${resolvedSessionPath}`,
          );
          const lines = raw.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              if (parsed.type === "custom") {
                if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id))
                  continue;
                customEntries.push({
                  id: (parsed.id as string) ?? `custom-${Date.now()}`,
                  customType: (parsed.customType as string) ?? "unknown",
                  data: parsed.data,
                  timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                });
              } else if (parsed.type === "compaction") {
                if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id))
                  continue;
                messages.push({
                  id: parsed.id,
                  role: "compactionSummary",
                  summary: parsed.summary ?? "",
                  tokensBefore: parsed.tokensBefore,
                  timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                });
              } else if (parsed.type === "message" && parsed.message) {
                if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id))
                  continue;
                messages.push(parsed.message);
              }
            } catch (err: unknown) {
              log.debug("skipping malformed JSONL entry (sandbox getMessages)", {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err: unknown) {
        log.warn("Failed to read sandbox JSONL in getMessages", {
          sessionPath: resolvedSessionPath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
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
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              customEntries.push({
                id: (parsed.id as string) ?? `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "compaction") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push({
                id: parsed.id,
                role: "compactionSummary",
                summary: parsed.summary ?? "",
                tokensBefore: parsed.tokensBefore,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (!managed && parsed.type === "message" && parsed.message) {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push(parsed.message);
            }
          } catch (err: unknown) {
            log.debug("skipping malformed JSONL entry", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        rl.close();
      } catch (err: unknown) {
        log.warn("Failed to read entries from JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { messages: messages as AgentMessageForUI[], customEntries };
  }

  async getFullMessages(
    sessionId: string,
    sessionPath?: string,
    options?: { limit?: number; afterEntryId?: string },
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }> {
    const t0 = performance.now();
    const managed = this.getActiveManaged(sessionId);

    // Resolve session file path first
    const resolvedSessionPath = managed
      ? managed.info.sessionPath
      : this.resolveSessionPath(sessionId) || sessionPath || "";

    // JSONL-first: always read messages directly from the JSONL file.
    // This avoids CLI OOM — CLI's get_full_messages handler uses readFile internally
    // which can blow the heap on large sessions (>8MB JSONL).
    const allMessages: Array<{ entryId: string; message: unknown }> = [];
    const allCustomEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];
    const parentById: Map<string, string | null> = new Map();
    const isSandboxSessionPath = resolvedSessionPath?.startsWith("/root/workspace/sessions/");

    if (isSandboxSessionPath && globalSandboxManager) {
      try {
        const userId = this._getSandboxUserId(sessionId);
        if (userId) {
          const raw = await globalSandboxManager.execInSandbox(
            userId,
            `cat ${resolvedSessionPath}`,
          );
          const lines = raw.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              const entryId = (parsed.id as string) ?? "";
              const parentId = (parsed.parentId as string | null | undefined) ?? null;
              if (entryId) {
                parentById.set(entryId, parentId);
              }
              if (parsed.type === "custom") {
                allCustomEntries.push({
                  id: entryId || `custom-${Date.now()}`,
                  customType: (parsed.customType as string) ?? "unknown",
                  data: parsed.data,
                  timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                });
              } else if (parsed.type === "message" && parsed.message) {
                allMessages.push({
                  entryId,
                  message: parsed.message,
                });
              }
            } catch (err: unknown) {
              log.debug("skipping malformed JSONL entry (sandbox)", {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      } catch (err: unknown) {
        log.warn("Failed to read sandbox JSONL", {
          sessionPath: resolvedSessionPath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
      try {
        const rl = readline.createInterface({
          input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const entryId = (parsed.id as string) ?? "";
            const parentId = (parsed.parentId as string | null | undefined) ?? null;
            if (entryId) {
              parentById.set(entryId, parentId);
            }
            if (parsed.type === "custom") {
              allCustomEntries.push({
                id: entryId || `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "message" && parsed.message) {
              allMessages.push({
                entryId,
                message: parsed.message,
              });
            }
          } catch (err: unknown) {
            log.debug("skipping malformed JSONL entry", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        rl.close();
      } catch (err: unknown) {
        log.warn("Failed to read entries from JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Resolve leafId from cache
    const leafId = this.leafIds.get(sessionId) ?? null;

    // Build leaf→root path set and filter messages to current branch only.
    let filteredMessages = allMessages;
    let customEntries = allCustomEntries;
    if (leafId && parentById.size > 0 && parentById.has(leafId)) {
      const pathIds = new Set<string>();
      let curId: string | null = leafId;
      while (curId) {
        pathIds.add(curId);
        const parent = parentById.get(curId);
        curId = parent ?? null;
      }
      filteredMessages = allMessages.filter((m) => pathIds.has(m.entryId));
      customEntries = allCustomEntries.filter((e) => pathIds.has(e.id));
    } else if (leafId && parentById.size > 0 && !parentById.has(leafId)) {
      log.warn("[getFullMessages] leafId not found in JSONL, skipping branch filter", {
        sessionId,
        leafId,
        totalEntries: parentById.size,
      });
    }

    // Apply pagination to filtered results (take from the end)
    const totalCount = filteredMessages.length;
    const limit = options?.limit;
    let hasMore = false;
    let nextCursor: string | null = null;

    let slicedMessages: unknown[];
    const injectEntryId = (e: { entryId: string; message: unknown }) => {
      const msg = e.message as Record<string, unknown>;
      if (msg && typeof msg === "object" && e.entryId) {
        return { ...msg, entryId: e.entryId };
      }
      return msg;
    };
    if (limit !== undefined && limit < totalCount) {
      slicedMessages = filteredMessages.slice(totalCount - limit).map(injectEntryId);
      hasMore = true;
      nextCursor = filteredMessages[totalCount - limit]?.entryId ?? null;
    } else {
      slicedMessages = filteredMessages.map(injectEntryId);
    }

    const totalMs = Math.round(performance.now() - t0);
    perfLog.info("[getFullMessages] done", {
      sessionId,
      messageCount: slicedMessages.length,
      totalCount,
      hasMore,
      leafId: leafId ?? "none",
      totalMs,
    });

    return {
      messages: slicedMessages as AgentMessageForUI[],
      customEntries,
      hasMore,
      totalCount,
      nextCursor,
    };
  }

  async getAvailableModels(
    sessionId: string,
  ): Promise<Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>> {
    // Retry with short delay: session may be mid-switch (agent.start in progress)
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      await new Promise((r) => setTimeout(r, 200));
      managed = this.getActiveManaged(sessionId);
    }
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return [];
    return (managed.client as SandboxRpcClient).getAvailableModels().catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getAvailableModels error, checking if CLI is alive", {
        sessionId,
        err: msg,
      });
      if (!(await this.isClientAlive(sessionId, managed))) {
        this.cleanupDeadClient(sessionId, `getAvailableModels failed: ${msg}`);
      }
      return [];
    });
  }

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<{ provider: string; id: string }> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) throw new Error("Client not found");
    return withTimeout(managed.client.setModel(provider, modelId), 15_000, "setModel");
  }

  async cycleModel(sessionId: string): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: string;
    isScoped: boolean;
  } | null> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return null;
    return managed.client.cycleModel().catch((err: unknown) => {
      log.warn("cycleModel error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client
      .setThinkingLevel(level as Parameters<typeof managed.client.setThinkingLevel>[0])
      .catch((err: unknown) => {
        log.warn("setThinkingLevel error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async cycleThinkingLevel(sessionId: string): Promise<{ level: string } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    return managed.client.cycleThinkingLevel().catch((err: unknown) => {
      log.warn("cycleThinkingLevel error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  }

  async compact(
    sessionId: string,
    customInstructions?: string,
  ): Promise<{ summary: string; tokensBefore: number }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return withTimeout(managed.client.compact(customInstructions), 120_000, "compact");
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setAutoCompaction(enabled).catch((err: unknown) => {
      log.warn("setAutoCompaction error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setAutoRetry(enabled).catch((err: unknown) => {
      log.warn("setAutoRetry error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async abortRetry(sessionId: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.abortRetry().catch((err: unknown) => {
      log.warn("abortRetry error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setSteeringMode(mode as "all" | "one-at-a-time").catch((err: unknown) => {
      log.warn("setSteeringMode error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setFollowUpMode(mode as "all" | "one-at-a-time").catch((err: unknown) => {
      log.warn("setFollowUpMode error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getActiveTools(sessionId: string): Promise<{ toolNames: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { toolNames: [] };
    try {
      const result = await withTimeout(managed.client.getActiveTools(), 10_000, "getActiveTools");
      return { toolNames: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getActiveTools error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { toolNames: [] };
    }
  }

  async setActiveTools(sessionId: string, toolNames: string[]): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client.setActiveTools(toolNames).catch((err: unknown) => {
      log.warn("setActiveTools error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { steering: [], followUp: [] };
    return managed.client.getQueue().catch((err: unknown) => {
      log.warn("getQueue error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { steering: [], followUp: [] };
    });
  }

  async clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { steering: [], followUp: [] };
    return managed.client.clearQueue().catch((err: unknown) => {
      log.warn("clearQueue error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { steering: [], followUp: [] };
    });
  }

  async getExtensions(sessionId: string): Promise<{
    extensions: Array<{
      path: string;
      resolvedPath: string;
      toolNames: string[];
      commandNames: string[];
    }>;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { extensions: [] };
    try {
      const result = await withTimeout(managed.client.getExtensions(), 10_000, "getExtensions");
      return { extensions: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getExtensions error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { extensions: [] };
    }
  }

  async getSkills(sessionId: string): Promise<{
    skills: Array<{
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      disableModelInvocation: boolean;
    }>;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { skills: [] };
    try {
      const result = await withTimeout(managed.client.getSkills(), 10_000, "getSkills");
      return { skills: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getSkills error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { skills: [] };
    }
  }

  async reload(sessionId: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await withTimeout(managed.client.reload(), 30_000, "reload");
  }

  async getTools(
    sessionId: string,
  ): Promise<{ tools: Array<{ name: string; label: string; description: string }> }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { tools: [] };
    try {
      const result = await withTimeout(managed.client.getTools(), 10_000, "getTools");
      return { tools: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getTools error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { tools: [] };
    }
  }

  async getMcpServers(sessionId: string): Promise<{ servers: McpServerInfo[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { servers: [] };
    try {
      const servers = await withTimeout(managed.client.getMcpServers(), 10_000, "getMcpServers");
      return { servers: Array.isArray(servers) ? servers : [] };
    } catch (err) {
      log.warn("getMcpServers error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { servers: [] };
    }
  }

  async toggleMcpServer(
    sessionId: string,
    name: string,
    enabled: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { success: false, error: "Client not found" };
    try {
      await managed.client.toggleMcpServer(name, enabled);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("toggleMcpServer error", { sessionId, err: msg });
      return { success: false, error: msg };
    }
  }

  async restartMcpServer(
    sessionId: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { success: false, error: "Client not found" };
    try {
      await managed.client.restartMcpServer(name);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("restartMcpServer error", { sessionId, err: msg });
      return { success: false, error: msg };
    }
  }

  async getContextUsage(
    sessionId: string,
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null }> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return { tokens: null, contextWindow: 0, percent: null };
    return managed.client.getContextUsage().catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getContextUsage error, checking if CLI is alive", {
        sessionId,
        err: msg,
      });
      if (!(await this.isClientAlive(sessionId, managed))) {
        this.cleanupDeadClient(sessionId, `getContextUsage failed: ${msg}`);
      }
      return { tokens: null, contextWindow: 0, percent: null };
    });
  }

  async getTierModels(sessionId: string): Promise<{ models: Record<string, string> }> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      await new Promise((r) => setTimeout(r, 200));
      managed = this.getActiveManaged(sessionId);
    }
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return { models: {} };
    const response = await (
      managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
    )
      .send({ type: "get_tier_models" })
      .catch((err: unknown) => {
        log.warn("getTierModels error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
    if (!response) return { models: {} };
    const data = (response as { data?: { models: Record<string, string> } }).data;
    return { models: data?.models ?? {} };
  }

  async setTierModels(sessionId: string, models: Record<string, string>): Promise<{ ok: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { ok: false };
    await (managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> })
      .send({ type: "set_tier_models", models })
      .catch((err: unknown) => {
        log.warn("setTierModels error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    return { ok: true };
  }

  async getAgents(sessionId: string): Promise<{
    agents: Array<{
      name: string;
      description?: string;
      tier?: string;
      tools?: string[];
      permissionMode?: string;
      source: string;
      filePath: string;
    }>;
  }> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return { agents: [] };
    try {
      const response = await (
        managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
      ).send({ type: "get_agents" });
      const data = (
        response as {
          data?: {
            agents: Array<{
              name: string;
              description?: string;
              tier?: string;
              tools?: string[];
              permissionMode?: string;
              source?: string;
              filePath?: string;
            }>;
          };
        }
      ).data;
      return {
        agents: (data?.agents ?? []).map((a) => ({
          ...a,
          source: a.source ?? "builtin",
          filePath: a.filePath ?? "",
        })),
      };
    } catch (err: unknown) {
      log.warn("getAgents error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { agents: [] };
    }
  }

  async switchAgent(
    sessionId: string,
    agentName: string,
  ): Promise<{
    agentName: string;
    tools: string[];
    tier?: string;
    thinkingLevel?: string;
  }> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) throw new Error("No agent process for session");
    const response = await (
      managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
    ).send({ type: "switch_agent", agentName });
    const data = (
      response as {
        data?: { agentName: string; tools: string[]; tier?: string; thinkingLevel?: string };
      }
    ).data;
    if (!data) throw new Error("switch_agent returned no data");
    return data;
  }

  async getCurrentAgent(sessionId: string): Promise<{ agentName: string | null }> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) return { agentName: null };
    try {
      const response = await (
        managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
      ).send({ type: "get_current_agent" });
      const data = (response as { data?: { agentName: string | null } }).data;
      return { agentName: data?.agentName ?? null };
    } catch (err: unknown) {
      log.warn("getCurrentAgent error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { agentName: null };
    }
  }

  async getAgentDetail(sessionId: string, agentName: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return (
      managed.client as unknown as {
        getAgentDetail: (name: string) => Promise<unknown>;
      }
    ).getAgentDetail(agentName);
  }

  async getAllTools(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return (
      managed.client as unknown as {
        getAllTools: () => Promise<unknown>;
      }
    ).getAllTools();
  }

  async getSystemPrompt(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error(`No client for session ${sessionId}`);
    return (
      managed.client as unknown as {
        getSystemPrompt: () => Promise<unknown>;
      }
    ).getSystemPrompt();
  }

  async getLatestAgentChange(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    try {
      const response = await (
        managed.client as unknown as { send: (cmd: unknown) => Promise<unknown> }
      ).send({ type: "get_latest_agent_change" });
      const data = (
        response as {
          data?: {
            agentName: string;
            agentConfig?: Record<string, unknown>;
            timestamp: string;
          } | null;
        }
      ).data;
      return data ?? null;
    } catch (err: unknown) {
      log.warn("getLatestAgentChange error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async getSettings(sessionId: string, scope?: string): Promise<Record<string, unknown>> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return {};
    return managed.client
      .getSettings(scope as "global" | "project" | undefined)
      .then((s) => s as unknown as Record<string, unknown>)
      .catch((err: unknown) => {
        log.warn("getSettings error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {};
      });
  }

  async setSettings(
    sessionId: string,
    settings: Record<string, unknown>,
    scope?: string,
  ): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client
      .setSettings(settings, scope as "global" | "project" | undefined)
      .catch((err: unknown) => {
        log.warn("setSettings error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    const projectPath = managed.info.projectPath;
    await managed.client.setSessionName(name).catch((err: unknown) => {
      log.warn("setSessionName error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    this.broadcastEvent(
      "agent.session_renamed",
      { sessionId, projectPath, newName: name },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(session_renamed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getLastAssistantText(sessionId: string): Promise<{ text: string | null }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { text: null };
    try {
      const result = await withTimeout(
        managed.client.getLastAssistantText(),
        10_000,
        "getLastAssistantText",
      );
      return { text: result };
    } catch (err: unknown) {
      log.warn("getLastAssistantText error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { text: null };
    }
  }

  async getForkMessages(
    sessionId: string,
  ): Promise<{ messages: Array<{ entryId: string; text: string }> }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { messages: [] };
    try {
      const result = await withTimeout(managed.client.getForkMessages(), 10_000, "getForkMessages");
      return { messages: Array.isArray(result) ? result : [] };
    } catch (err: unknown) {
      log.warn("getForkMessages error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { messages: [] };
    }
  }

  async fork(
    sessionId: string,
    entryId: string,
    options?: { position?: "before" | "at" },
  ): Promise<{
    text: string;
    cancelled: boolean;
    newSessionFile?: string;
    newSessionId?: string;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    const result = await withTimeout(managed.client.fork(entryId, options), 60_000, "fork");
    // Don't stop the original session — the process pool's switchSession
    // will handle the transition when the forked session is started.
    // The original session remains on disk and can be re-activated later.
    // Strip parentSession from forked session so it's treated as independent on refresh
    if (result.newSessionFile && !result.cancelled) {
      stripParentSessionFromHeader(result.newSessionFile);
    }
    return result;
  }

  async navigateTree(
    sessionId: string,
    targetId: string,
    options?: { summarize?: boolean; skipFiles?: boolean },
  ): Promise<{ cancelled: boolean; reason?: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      // Block rollback while agent is actively streaming
      if (managed.info.status === "streaming") {
        log.warn("navigateTree: blocked — agent is streaming", { sessionId, targetId });
        return { cancelled: true, reason: "Agent is streaming" };
      }
      const result = await withTimeout(
        managed.client.navigateTree(targetId, options),
        30_000,
        "navigateTree",
      );
      if (!result.cancelled) {
        this.leafIds.set(sessionId, targetId);
        log.info("navigateTree updated leafId", { sessionId, targetId });
      }
      return result;
    }
    log.info("navigateTree: no managed client, applying JSONL fallback", {
      sessionId,
      targetId,
    });

    const sessionPath = this.resolveSessionPath(sessionId);
    if (!sessionPath) {
      return { cancelled: true, reason: "No session path found" };
    }

    const entries = await this.readJsonlEntries(sessionPath);
    const exists = entries.some((e) => e.id === targetId);
    if (!exists) {
      return { cancelled: true, reason: "Target entry not found in session" };
    }

    this.leafIds.set(sessionId, targetId);

    if (!options?.skipFiles) {
      log.warn("navigateTree: file restore skipped (no active CLI process)", {
        sessionId,
        targetId,
      });
    }

    log.info("navigateTree: JSONL fallback applied", { sessionId, targetId });
    return { cancelled: false };
  }

  async previewRollback(
    sessionId: string,
    targetId: string,
  ): Promise<{ restored: string[]; deleted: string[] }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      return withTimeout(managed.client.previewRollback(targetId), 15_000, "previewRollback");
    }
    return { restored: [], deleted: [] };
  }

  async getModifiedFiles(
    sessionId: string,
    fromEntryId?: string,
    toEntryId?: string,
    toUserMsgEntryId?: string,
  ): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      turnIndex: number;
      entryId: string;
    }>;
    resolvedFromEntryId: string | null;
  }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      const result = await withTimeout(
        managed.client.getModifiedFiles({
          fromEntryId,
          toEntryId,
          ...((toUserMsgEntryId ? { toUserMsgEntryId } : {}) as Record<string, string>),
        }),
        15_000,
        "getModifiedFiles",
      );
      return result;
    }
    return { files: [], resolvedFromEntryId: null };
  }

  async getFileDiff(
    sessionId: string,
    filePath: string,
    fromEntryId?: string,
    toEntryId?: string,
  ): Promise<{
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
  } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      const result = await withTimeout(
        managed.client.getFileDiff({ filePath, fromEntryId, toEntryId }),
        15_000,
        "getFileDiff",
      );
      return result;
    }
    return null;
  }

  async getBatchDiffs(
    sessionId: string,
    fromEntryId?: string,
    toEntryId?: string,
  ): Promise<{
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
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      return withTimeout(
        managed.client.getBatchDiffs({ fromEntryId, toEntryId }),
        30_000,
        "getBatchDiffs",
      );
    }
    return { files: [], summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 } };
  }

  async getTree(sessionId: string): Promise<{ entries: TreeEntry[]; leafId?: string | null }> {
    const managed = this.getActiveManaged(sessionId);
    if (managed) {
      try {
        const result = await withTimeout(managed.client.getTree(), 15_000, "getTree");
        return {
          entries: Array.isArray(result.entries) ? (result.entries as TreeEntry[]) : [],
          leafId: result.leafId,
        };
      } catch (err: unknown) {
        log.warn("getTree SDK failed, falling back to JSONL", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const sessionPath = this.resolveSessionPath(sessionId);
    if (!sessionPath) throw new Error("Client not found and no session path");
    const entries = await this.readJsonlEntries(sessionPath);
    return {
      entries: entries.map((e) => ({
        id: e.id,
        parentId: e.parentId,
        type: e.type,
        label: e.label,
      })),
      leafId: this.leafIds.get(sessionId) ?? null,
    };
  }

  async restoreFilesFromSnapshot(
    sessionId: string,
    snapshotTreeHash: string,
    files?: string[],
  ): Promise<string[]> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");

    const result = (await managed.client
      .channel("file-snapshot")
      .call("snapshot.restoreByHash", { snapshotTreeHash, files })) as {
      restored: string[];
    } | null;

    return result?.restored ?? [];
  }

  async clone(sessionId: string): Promise<{ cancelled: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return withTimeout(managed.client.clone(), 60_000, "clone");
  }

  async newSession(sessionId: string, parentSession?: string): Promise<{ cancelled: boolean }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return withTimeout(managed.client.newSession(parentSession), 30_000, "newSession");
  }

  async exportHtml(sessionId: string, outputPath?: string): Promise<{ path: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return withTimeout(managed.client.exportHtml(outputPath), 60_000, "exportHtml");
  }

  sendChannelData(sessionId: string, channelName: string, data: unknown): void {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    const ch = managed.client.channel(channelName);
    ch.send(data);
  }

  callChannel<CN extends keyof ChannelTypeRegistry, MN extends ChannelMethodKeys<CN>>(
    sessionId: string,
    channelName: CN,
    method: MN,
    params: ChannelMethodParams<CN, MN>,
  ): Promise<ChannelMethodReturn<CN, MN>>;

  callChannel(
    sessionId: string,
    channelName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;

  async callChannel(
    sessionId: string,
    channelName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      await new Promise((r) => setTimeout(r, 200));
      managed = this.getActiveManaged(sessionId);
    }
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) throw new Error("Client not found");
    const ch = managed.client.channel(channelName);
    return ch.call(method, params);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    const managed = this.getActiveManaged(sessionId);
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
      if (ch.name === "supervisor") {
        this.handleSupervisorChannelData(sessionId, ch);
        return;
      }
      if (ch.name === "coordinator") {
        log.warn(
          "coordinator channel_data reached handleEvent — should have been intercepted in start()",
          { sessionId },
        );
        return;
      }
    }

    if (event.type === "extension_ui_request") {
      const ui = event as ExtensionUIRequestEvent;
      const INTERACTIVE_METHODS = new Set(["confirm", "input", "select", "editor"]);
      if (ui.method === "notify") {
        this.broadcastEvent(
          "agent.notify",
          {
            sessionId,
            message: ui.message ?? "",
            notifyType: ui.notifyType ?? "info",
          },
          { sessionId },
        ).catch((err: unknown) => {
          log.warn("broadcastEvent(agent.notify) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
        return;
      }
      if (!INTERACTIVE_METHODS.has(ui.method)) return;
    }

    if (event.type === "agent_start") {
      managed.info.status = "streaming";
      managed.lastActiveAt = Date.now();
      managed.info.holdEvents = [];
      this.broadcastSessionStatus(sessionId, "streaming");
    }

    if (event.type === "agent_end") {
      managed.info.status = "idle";
      managed.lastActiveAt = Date.now();
      managed.info.holdEvents = [];
      this.broadcastSessionStatus(sessionId, "idle");

      if (config.sandboxEnabled && managed.info.projectPath) {
        this.broadcastEvent(
          "file.changed",
          {
            changedPath: managed.info.projectPath,
            type: "create",
          },
          { sessionId },
        ).catch(() => {});
      }

      const resolver = this.syncDelegateResolvers.get(sessionId);
      if (resolver) {
        clearTimeout(resolver.timeout);
        this.syncDelegateResolvers.delete(sessionId);
        this.subagentSyncChildren.delete(sessionId);
        const finalText = this.syncDelegateLastText.get(sessionId) ?? "(completed)";
        this.syncDelegateLastText.delete(sessionId);
        resolver.resolve({
          sessionId,
          status: "completed",
          exitCode: 0,
          finalText: finalText || "(completed)",
        });
      }
    }

    if (event.type === "session_info_changed") {
      const name = (event as Record<string, unknown>).name;
      if (typeof name === "string" && name.length > 0) {
        const projectPath = managed.info.projectPath;
        this.broadcastEvent(
          "agent.session_renamed",
          { sessionId, projectPath, newName: name },
          {},
        ).catch((err: unknown) => {
          log.warn("broadcastEvent(session_renamed from info_changed) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return;
    }

    if (event.type === "message_end") {
      managed.info.holdEvents = [];
      if (this.subagentSyncChildren.has(sessionId)) {
        const msgEvent = event as {
          type: "message_end";
          message: { content?: Array<{ type: string; text?: string }> };
        };
        const msg = msgEvent.message;
        if (Array.isArray(msg?.content)) {
          const text = msg.content
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("")
            .slice(0, 2000);
          if (text) this.syncDelegateLastText.set(sessionId, text);
        }
      }
    }

    if (event.type === "message_update") {
      managed.info.status = "streaming";
    }

    const sanitized = sanitizeEvent(event);

    if (managed.info.status === "streaming") {
      managed.info.holdEvents.push(sanitized);
    }

    const parentId = this.findParentSession(sessionId);
    if (parentId) {
      this.broadcastEvent(
        "coordinator.session_event",
        {
          parentSessionId: parentId,
          childSessionId: sessionId,
          event: sanitized,
        },
        { parentSessionId: parentId },
      ).catch((err: unknown) => {
        log.warn("broadcastEvent(coordinator.session_event) error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });

      if (this.subagentSyncChildren.has(sessionId) && event.type !== "channel_data") {
        const parentManaged = this.clients.get(parentId);
        this.broadcastEvent(
          "subagent.event",
          {
            parentSessionId: parentId,
            parentSessionPath: parentManaged?.info.sessionPath ?? "",
            subSessionId: sessionId,
            event: sanitized,
          },
          { parentSessionId: parentId },
        ).catch(() => {});
      }
    }

    this.emitAgentEvent(sessionId, sanitized);
  }

  private async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as SubagentChannelPayload | undefined;
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
    const data = channelMsg.data as unknown as TodoChannelEvent | undefined;
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
    const data = channelMsg.data as unknown as BashChannelEvent | undefined;
    if (!data) return;

    log.info("Bash channel data", { sessionId, type: data.type, toolCallId: data.toolCallId });

    const managed = this.clients.get(sessionId);
    if (managed && data.toolCallId) {
      if (data.type === "background") {
        managed.activeBackgroundTools.add(data.toolCallId);
      } else if (data.type === "end" || data.type === "error" || data.type === "terminated") {
        managed.activeBackgroundTools.delete(data.toolCallId);
      }
    }

    await this.broadcastEvent("bash.event", { sessionId, event: data }, { sessionId });
  }

  private async handleSupervisorChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as Record<string, unknown> | undefined;
    if (!data) return;

    log.info("Supervisor channel data", { sessionId, type: data.type });

    await this.broadcastEvent("supervisor.event", { sessionId, event: data }, { sessionId });
  }

  private async handleLspChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as unknown as LspChannelEvent | undefined;
    if (!data) return;

    // Enhanced LSP logging for diagnostics review
    const lspLogData: Record<string, unknown> = {
      sessionId,
      event: data.event,
    };
    if (data.serverName) lspLogData.serverName = data.serverName;
    if (data.totalServers != null) lspLogData.totalServers = data.totalServers;
    if (data.servers?.length) lspLogData.serverCount = data.servers.length;
    if (data.mode) lspLogData.mode = data.mode;
    if (data.languages?.length) lspLogData.languages = data.languages;
    if (data.filePath) lspLogData.filePath = data.filePath;
    if (data.diagnostics)
      lspLogData.diagnosticsCount = Array.isArray(data.diagnostics)
        ? data.diagnostics.length
        : Object.keys(data.diagnostics).length;
    if (data.error) lspLogData.error = data.error;
    // Derive aggregate state for startup/status events
    if (data.servers?.length) {
      const anyReady = data.servers.some((s: { state?: string }) => s.state === "ready");
      const anyError = data.servers.some((s: { state?: string }) => s.state === "error");
      lspLogData.aggregateState = anyReady ? "ready" : anyError ? "error" : "starting";
    }
    log.info("LSP channel data", lspLogData);

    if (data.event === "startup_complete" || data.event === "status_changed") {
      const servers = (data.servers ?? []) as Array<{
        state?: string;
        status?: { state?: string };
      }>;
      const cached = this.lastLspState.get(sessionId);
      this.lastLspState.set(sessionId, {
        state: servers.some((s) => s.state === "ready" || s.status?.state === "ready")
          ? "ready"
          : servers.some((s) => s.state === "error" || s.status?.state === "error")
            ? "error"
            : servers.length > 0
              ? "starting"
              : "inactive",
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
        cached.activeLanguages = Array.from(
          new Set([...(cached.activeLanguages ?? []), ...data.languages]),
        );
      }
    }
  }

  private async handleRulesChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    const data = channelMsg.data as RulesChannelEvent;
    if (!data) return;

    log.info("Rules channel data", { sessionId, type: data.type });

    await this.broadcastEvent("rules.event", { sessionId, event: data }, { sessionId });
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
      await this.broadcastEvent(
        "memory.bookmark_creating",
        { sessionId, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_updated") {
      await this.broadcastEvent(
        "memory.updated",
        { sessionId, files: data.files, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_update_failed") {
      await this.broadcastEvent(
        "memory.update_failed",
        { sessionId, reason: data.reason, timestamp: Date.now() },
        { sessionId },
      );
    } else if (eventType === "memory_irrelevant_marked") {
      await this.broadcastEvent(
        "memory.memory_irrelevant_marked",
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    } else if (
      eventType === "memory_prefetch" ||
      eventType === "memory_extract" ||
      eventType === "memory_dream"
    ) {
      await this.broadcastEvent(
        `memory.${eventType}`,
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    } else if (
      eventType === "memory_prefetch_result" ||
      eventType === "memory_extract_result" ||
      eventType === "memory_dream_result"
    ) {
      await this.broadcastEvent(
        `memory.${eventType}`,
        { sessionId, ...data, timestamp: Date.now() },
        { sessionId },
      );
    }
  }

  private async handleCoordinatorCall(
    sessionId: string,
    data: unknown,
    channelName: string,
  ): Promise<void> {
    const msg = data as CoordinatorChannelEvent;

    if (!("__call" in msg)) {
      this.broadcastEvent("coordinator.event", { sessionId, event: msg }, { sessionId }).catch(
        (err: unknown) => {
          log.warn("broadcastEvent(coordinator.event) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        },
      );
      return;
    }

    const { __call: method, invokeId } = msg;
    let result: unknown;
    try {
      switch (method) {
        case "session_delegate":
          if (this._startInProgress) {
            // Queue the request — will be processed after current start() finishes
            log.info("[coordinator] session_delegate queued (start in progress)", { sessionId });
            result = await new Promise<unknown>((resolve) => {
              this._pendingDelegateRequests.push({ sessionId, msg, channelName, resolve });
            });
          } else {
            result = await this.handleCoordinatorDelegate(sessionId, msg);
          }
          break;
        case "session_delegate_send":
          result = await this.handleCoordinatorDelegateSend(msg);
          break;
        case "session_delegate_sync":
          if (this._startInProgress) {
            log.info("[coordinator] session_delegate_sync queued (start in progress)", {
              sessionId,
            });
            result = await new Promise<unknown>((resolve) => {
              this._pendingDelegateRequests.push({ sessionId, msg, channelName, resolve });
            });
          } else {
            result = await this.handleCoordinatorDelegateSync(sessionId, msg);
          }
          break;
        case "session_delegate_status":
          result = await this.handleCoordinatorDelegateStatus(msg);
          break;
        case "session_delegate_list":
          result = this.handleCoordinatorDelegateList(sessionId);
          break;
        case "session_delegate_stop":
          result = await this.handleCoordinatorDelegateStop(sessionId, msg);
          break;
        case "session_delegate_fork":
          result = await this.handleCoordinatorDelegateFork(sessionId, msg);
          break;
        default:
          if (method === "session_delegate_clear_stopped") {
            result = this.handleCoordinatorClearStopped(msg);
          } else if (method === "session_delegate_remove") {
            result = this.handleCoordinatorRemove(sessionId, msg);
          } else {
            log.warn("Unknown coordinator method", { sessionId, method });
            return;
          }
      }
    } catch (err: unknown) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }

    if (invokeId) {
      let managed = this.getActiveManaged(sessionId);
      // The session may have been evicted from clients during an async handler
      // (e.g. delegate_send restarts the target).
      // Fall back to processByCwd via sessionProjectPaths to find the channel.
      if (!managed) {
        const projectPath = this.sessionProjectPaths.get(sessionId) ?? "";
        if (projectPath) {
          const procSet = this.processByCwd.get(projectPath);
          if (procSet) {
            for (const mc of procSet) {
              if (mc._activeSessionId === sessionId) {
                managed = mc;
                log.info("handleCoordinatorCall: routed response via processByCwd fallback", {
                  sessionId,
                  projectPath,
                  activeSession: managed._activeSessionId,
                });
                break;
              }
            }
          }
          if (!managed) {
            log.warn(
              "handleCoordinatorCall: processByCwd fallback could not find matching process",
              {
                sessionId,
                projectPath,
                processCount: procSet?.size ?? 0,
              },
            );
          }
        }
      }
      if (managed) {
        managed.client.channel(channelName).send({ ...(result as object), invokeId });
      }
    }
  }

  private handleCoordinatorClearStopped(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_clear_stopped" }>,
  ): { cleared: string[] } {
    const targetSessionId = (msg as Record<string, unknown>).sessionId as string | undefined;
    const cleared: string[] = [];
    if (targetSessionId) {
      this.delegateCreatedAt.delete(targetSessionId);
      this.delegateReplyCount.delete(targetSessionId);
      cleared.push(targetSessionId);
    }
    return { cleared };
  }

  private handleCoordinatorRemove(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_remove" }>,
  ): { removed: boolean } {
    const targetSessionId = (msg as Record<string, unknown>).targetSessionId as string | undefined;
    if (!targetSessionId) return { removed: false };

    const children = this.parentChildMap.get(parentSessionId);
    if (children) {
      children.delete(targetSessionId);
      if (children.size === 0) this.parentChildMap.delete(parentSessionId);
    }
    this.delegateCreatedAt.delete(targetSessionId);
    this.delegateReplyCount.delete(targetSessionId);
    this.stop(targetSessionId);
    return { removed: true };
  }

  private async handleCoordinatorDelegate(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    const { task, projectPath: rawProjectPath } = msg;
    const parent = this.getActiveManaged(parentSessionId);
    if (!parent) throw new Error("Parent session not found");

    const projectPath = rawProjectPath ?? parent.info.projectPath;
    const newSessionId = `sess_coord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isCrossProject = rawProjectPath && rawProjectPath !== parent.info.projectPath;
    let sessionDir: string;
    if (isCrossProject) {
      // 跨项目：用目标项目路径编码，放到 ~/.pi/agent/sessions/ 下，扫描器才能找到
      const encodedTarget = "--" + projectPath.replace(/^\//, "").replace(/\//g, "-") + "--";
      sessionDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedTarget);
      if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    } else {
      sessionDir = path.dirname(parent.info.sessionPath);
    }
    const sessionPath = path.join(sessionDir, `${newSessionId}.jsonl`);

    try {
      const { writeFile } = await import("fs/promises");
      const headerEntry = JSON.stringify({
        type: "session",
        version: 3,
        id: newSessionId,
        timestamp: new Date().toISOString(),
        cwd: projectPath,
        delegateParentSessionId: parentSessionId,
      });
      const delegateInfoEntry = JSON.stringify({
        type: "delegate_info",
        delegateParentSessionId: parentSessionId,
        parentSessionPath: parent.info.sessionPath,
        delegateType: "coordinator",
        createdAt: Date.now(),
      });
      await writeFile(sessionPath, headerEntry + "\n" + delegateInfoEntry + "\n", "utf-8");
    } catch (writeErr: unknown) {
      log.warn("[handleCoordinatorDelegate] failed to write session header", {
        sessionPath,
        err: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }

    const result = await this.start(newSessionId, projectPath, sessionPath, {
      forceNewProcess: true,
    });

    this.delegateCreatedAt.set(newSessionId, Date.now());
    this.delegateReplyCount.set(newSessionId, 0);

    // Register parent-child relationship
    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(newSessionId);

    const rawTitle = msg.title ?? task.slice(0, 60);
    const title = `指派: ${rawTitle}`;
    await this.setSessionName(newSessionId, title);
    const projectName = projectPath.split("/").pop() ?? projectPath;
    const delegatePrompt = [
      `[系统提示] 你是一个被委派的后台任务会话。`,
      ``,
      `**你的身份信息：**`,
      `- 你的会话 ID: ${newSessionId}`,
      `- 委派方（父会话）ID: ${parentSessionId}`,
      `- 任务: ${title}`,
      `- 项目路径: ${projectPath}`,
      `- 项目名称: ${projectName}`,
      ``,
      `**要求：**`,
      `1. 你是独立执行任务的助手，专注于完成委派给你的任务`,
      `2. 执行完毕后，请明确总结你的工作成果`,
      `3. 如果遇到问题无法继续，请说明原因`,
      `4. 如需向委派方反馈中间进度或最终结果，请使用 session_delegate_send 工具：`,
      `   - targetSessionId: ${parentSessionId}`,
      `   - message: 你要反馈的内容`,
      ``,
      `---`,
      ``,
      task,
    ].join("\n");

    this.send(newSessionId, delegatePrompt);

    this.broadcastEvent(
      "coordinator.session_created",
      {
        parentSessionId,
        session: {
          sessionId: newSessionId,
          name: title,
          sessionPath,
          projectPath,
          parentSessionPath: parent.info.sessionPath,
          delegateParentSessionId: parentSessionId,
          delegateType: "coordinator",
          messageCount: 0,
          firstMessage: task,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "running" as const,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return { sessionId: newSessionId, status: result.status };
  }

  private async handleCoordinatorDelegateSync(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
  ): Promise<{
    sessionId: string;
    status: string;
    exitCode: number;
    finalText: string;
    error?: string;
  }> {
    const { task, title, agent, timeoutMs = 300000, projectPath: rawProjectPath } = msg;
    const parent = this.getActiveManaged(parentSessionId);
    if (!parent) throw new Error("Parent session not found");

    const projectPath = rawProjectPath ?? parent.info.projectPath;
    const newSessionId = `sess_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const isCrossProject = rawProjectPath && rawProjectPath !== parent.info.projectPath;
    let sessionDir: string;
    if (isCrossProject) {
      // 跨项目：用目标项目路径编码，放到 ~/.pi/agent/sessions/ 下，扫描器才能找到
      const encodedTarget = "--" + projectPath.replace(/^\//, "").replace(/\//g, "-") + "--";
      sessionDir = path.join(os.homedir(), ".pi", "agent", "sessions", encodedTarget);
      if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    } else {
      sessionDir = path.dirname(parent.info.sessionPath);
    }
    const sessionPath = path.join(sessionDir, `${newSessionId}.jsonl`);

    try {
      const { writeFile } = await import("fs/promises");
      const headerEntry = JSON.stringify({
        type: "session",
        version: 3,
        id: newSessionId,
        timestamp: new Date().toISOString(),
        cwd: projectPath,
        delegateParentSessionId: parentSessionId,
      });
      const delegateInfoEntry = JSON.stringify({
        type: "delegate_info",
        delegateParentSessionId: parentSessionId,
        parentSessionPath: parent.info.sessionPath,
        delegateType: "subagent",
        createdAt: Date.now(),
      });
      await writeFile(sessionPath, headerEntry + "\n" + delegateInfoEntry + "\n", "utf-8");
    } catch (writeErr: unknown) {
      log.warn("[handleCoordinatorDelegateSync] failed to write session header", {
        sessionPath,
        err: writeErr instanceof Error ? writeErr.message : String(writeErr),
      });
    }

    await this.start(newSessionId, projectPath, sessionPath, { forceNewProcess: true });

    if (agent) {
      try {
        await this.switchAgent(newSessionId, agent);
        log.info("[handleCoordinatorDelegateSync] agent switched", {
          newSessionId,
          agent,
        });
      } catch (switchErr: unknown) {
        log.warn("[handleCoordinatorDelegateSync] switchAgent failed, using default agent", {
          newSessionId,
          agent,
          err: switchErr instanceof Error ? switchErr.message : String(switchErr),
        });
      }
    }

    this.delegateCreatedAt.set(newSessionId, Date.now());
    this.delegateReplyCount.set(newSessionId, 0);

    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(newSessionId);

    const rawTitle = title ?? task.slice(0, 60);
    const sessionTitle = `子代理: ${rawTitle}`;
    await this.setSessionName(newSessionId, sessionTitle);

    const projectName = projectPath.split("/").pop() ?? projectPath;
    const delegatePrompt = [
      `[系统提示] 你是一个子代理任务会话。`,
      agent ? `**Agent 角色:** ${agent}` : "",
      `**任务:** ${rawTitle}`,
      `**项目:** ${projectName}`,
      `**项目路径:** ${projectPath}`,
      ``,
      `要求：`,
      `1. 专注于完成委派给你的任务`,
      `2. 执行完毕后，明确总结你的工作成果`,
      `3. 如果遇到问题无法继续，说明原因`,
      ``,
      `---`,
      ``,
      task,
    ]
      .filter(Boolean)
      .join("\n");

    this.subagentSyncChildren.add(newSessionId);

    const syncPromise = new Promise<{
      sessionId: string;
      status: string;
      exitCode: number;
      finalText: string;
      error?: string;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn("[syncDelegate] timed out", {
          sessionId: newSessionId,
          parentSessionId,
          timeoutMs,
        });
        this.syncDelegateResolvers.delete(newSessionId);
        this.subagentSyncChildren.delete(newSessionId);
        this.syncDelegateLastText.delete(newSessionId);
        resolve({
          sessionId: newSessionId,
          status: "timeout",
          exitCode: 1,
          finalText: "(timed out)",
        });
      }, timeoutMs);

      this.syncDelegateResolvers.set(newSessionId, {
        resolve,
        timeout,
        parentSessionId,
      });
    });

    this.send(newSessionId, delegatePrompt);

    this.broadcastEvent(
      "coordinator.session_created",
      {
        parentSessionId,
        session: {
          sessionId: newSessionId,
          name: rawTitle,
          sessionPath,
          projectPath,
          parentSessionPath: parent.info.sessionPath,
          delegateParentSessionId: parentSessionId,
          delegateType: "subagent",
          messageCount: 0,
          firstMessage: task,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "running" as const,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId,
        newSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    this.broadcastEvent(
      "subagent.event",
      {
        parentSessionId,
        parentSessionPath: parent.info.sessionPath,
        subSessionId: newSessionId,
        event: {
          type: "subagent_start",
          toolCallId: "",
          description: rawTitle,
          instruction: task,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(subagent_start) error", {
        parentSessionId,
        newSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    const syncResult = await syncPromise;

    this.stop(newSessionId);

    const syncChildren = this.parentChildMap.get(parentSessionId);
    if (syncChildren) {
      syncChildren.delete(newSessionId);
      if (syncChildren.size === 0) this.parentChildMap.delete(parentSessionId);
    }

    return syncResult;
  }

  private async handleCoordinatorDelegateSend(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
  ): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
    const { targetSessionId, message } = msg;

    let target = this.clients.get(targetSessionId);

    // Not active — attempt restart, like clicking a session in the UI.
    // Session truly "not found" only if the file was physically deleted.
    if (!target) {
      const sessionPath = this.sessionPaths.get(targetSessionId) ?? "";
      const projectPath = this.sessionProjectPaths.get(targetSessionId) ?? "";
      if (sessionPath && projectPath && existsSync(sessionPath)) {
        try {
          const result = await this.start(targetSessionId, projectPath, sessionPath);
          target = this.clients.get(targetSessionId);
          if (target) {
            log.info("handleCoordinatorDelegateSend: restarted inactive session", {
              targetSessionId,
              status: result.status,
            });
          }
        } catch (err: unknown) {
          log.warn("handleCoordinatorDelegateSend: failed to restart session", {
            targetSessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (!target) {
        return { delivered: false, targetStatus: "not_found" };
      }
    }

    const count = (this.delegateReplyCount.get(targetSessionId) ?? 0) + 1;
    this.delegateReplyCount.set(targetSessionId, count);

    const createdAt = this.delegateCreatedAt.get(targetSessionId) ?? Date.now();
    const elapsedMs = Date.now() - createdAt;
    const elapsed =
      elapsedMs < 60000 ? `${Math.round(elapsedMs / 1000)}s` : `${Math.round(elapsedMs / 60000)}m`;

    const parentSessionId = this.findParentSession(targetSessionId);
    let title = "";
    if (parentSessionId) {
      const parent = this.clients.get(parentSessionId);
      if (parent) {
        title = target.info.sessionPath.split("/").pop()?.replace(".jsonl", "") ?? "";
      }
    }

    const wrappedMessage = [
      `<delegate-reply from="${targetSessionId}" title="${title}" sequence="${count}" createdAt="${createdAt}" elapsed="${elapsed}" historyCount="${count}">`,
      message,
      `</delegate-reply>`,
    ].join("\n");

    if (msg.mode === "steer") {
      this.steer(targetSessionId, wrappedMessage);
    } else if (msg.mode === "followUp" || target.info.status === "streaming") {
      this.followUp(targetSessionId, wrappedMessage);
    } else {
      this.send(targetSessionId, wrappedMessage);
    }

    return { delivered: true, targetStatus: "active" };
  }

  private async handleCoordinatorDelegateStatus(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>,
  ): Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }> {
    const { sessionId: targetSessionId } = msg;

    const status = this.getStatus(targetSessionId);
    if (status.status === "stopped") {
      // Distinguish "session never existed" from "session existed but is inactive"
      const hasRecord =
        this.sessionPaths.has(targetSessionId) || this.sessionProjectPaths.has(targetSessionId);
      return {
        status: hasRecord ? "stopped" : "not_found",
        isCompacting: false,
        contextUsage: { tokens: null, contextWindow: 0, percent: null },
      };
    }

    const state = await this.getState(targetSessionId);
    const contextUsage = await this.getContextUsage(targetSessionId);

    return {
      status: state?.isStreaming ? "streaming" : "idle",
      isCompacting: state?.isCompacting ?? false,
      contextUsage,
    };
  }

  private handleCoordinatorDelegateList(parentSessionId: string): {
    sessions: Array<{ sessionId: string; status: string; projectPath: string }>;
  } {
    const children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      return { sessions: [] };
    }
    const sessions: Array<{ sessionId: string; status: string; projectPath: string }> = [];
    for (const childId of children) {
      const managed = this.clients.get(childId);
      if (managed) {
        sessions.push({
          sessionId: childId,
          status: managed.info.status,
          projectPath: managed.info.projectPath,
        });
      }
    }
    return { sessions };
  }

  private async handleCoordinatorDelegateStop(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>,
  ): Promise<{ ok: boolean }> {
    const { sessionId: targetSessionId } = msg;
    // Only allow stopping own children
    const children = this.parentChildMap.get(parentSessionId);
    if (!children || !children.has(targetSessionId)) {
      return { ok: false };
    }
    const ok = this.stop(targetSessionId);
    return { ok };
  }

  private async handleCoordinatorDelegateFork(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    const { task, sessionId: targetSessionId } = msg;
    const base = this.clients.get(targetSessionId);
    if (!base) throw new Error(`Session not found: ${targetSessionId}`);

    const sessionPath = base.info.sessionPath;
    const projectPath = base.info.projectPath;
    const sessionDir = path.dirname(sessionPath);

    const forkedSessionId = `sess_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const forkedPath = path.join(sessionDir, `${forkedSessionId}.jsonl`);

    if (existsSync(sessionPath)) {
      copyFileSync(sessionPath, forkedPath);
    }

    // Strip parentSession so the forked session is independent (not a child)
    stripParentSessionFromHeader(forkedPath);

    const result = await this.start(forkedSessionId, projectPath, forkedPath, {
      forceNewProcess: true,
    });

    // Register parent-child relationship
    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(forkedSessionId);

    const title = msg.title ?? task.slice(0, 60);
    await this.setSessionName(forkedSessionId, title);
    this.send(forkedSessionId, task);

    this.broadcastEvent(
      "coordinator.session_created",
      {
        parentSessionId,
        session: {
          sessionId: forkedSessionId,
          name: title,
          sessionPath: forkedPath,
          projectPath,
          parentSessionPath: sessionPath,
          delegateParentSessionId: parentSessionId,
          delegateType: "fork",
          messageCount: 0,
          firstMessage: task,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "running" as const,
        },
      },
      { parentSessionId },
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created from fork) error", {
        sessionId: forkedSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

    return { sessionId: forkedSessionId, status: result.status };
  }

  private async emitAgentEvent(sessionId: string, event: SanitizedEvent): Promise<void> {
    await this.broadcastEvent("agent.event", { sessionId, event }, { sessionId });
  }

  async sendChannelMessage(
    sessionId: string,
    channelName: string,
    data: unknown,
  ): Promise<unknown> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    try {
      const ch = managed.client.channel(channelName);
      return await ch.invoke(data);
    } catch (err: unknown) {
      log.warn("sendChannelMessage failed", {
        sessionId,
        channelName,
        err: (err as Error).message,
      });
      return null;
    }
  }

  hasSession(sessionId: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    return managed !== undefined;
  }

  getProjectPath(sessionId: string): string | undefined {
    const managed = this.getActiveManaged(sessionId);
    return managed?.info?.projectPath;
  }

  getSessionPath(sessionId: string): string {
    const managed = this.getActiveManaged(sessionId);
    if (managed) return managed.info.sessionPath;
    return this.sessionPaths.get(sessionId) ?? "";
  }

  getCachedLspState(
    sessionId: string,
  ): { state: string; servers: unknown[]; mode?: string } | undefined {
    return this.lastLspState.get(sessionId);
  }
}
