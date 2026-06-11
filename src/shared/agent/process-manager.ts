import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";

import * as path from "path";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  AgentMessageForUI,
  ChannelDataEvent,
} from "../modules/agent";
import type { AssistantMessage, AssistantMessageEvent, ImageContent } from "@dyyz1993/pi-ai";
import type { RpcClientAPI, ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";
import type { TreeEntry } from "../modules/agent";
import { performance } from "perf_hooks";
import { SessionMessageReader } from "./session-message-reader";
import { AgentEventHandler } from "./event-handler";
import type { AgentEventHandlerDeps } from "./event-handler";
import { CoordinatorHandler } from "./coordinator-handler";

// 沙箱模式
import { SandboxManager } from "../../sandbox/sandbox-manager";
import { SandboxBoxProvider } from "../../sandbox/providers/sandbox-box";
import type { ISandboxProvider } from "../../sandbox/types";
import { SandboxRpcClient } from "../../sandbox/sandbox-rpc-client";

type McpServerInfo = Awaited<ReturnType<RpcClientInstance["getMcpServers"]>>[number];

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
import type { CoordinatorMethodCall } from "../modules/coordinator";
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
function scanExtensionDir(dir: string, extensionPaths: string[]): void {
  if (!existsSync(dir)) return;

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__tests__")
        continue;

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(path.join(dir, entry.name));
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch (e) {
          log.debug("scanExtensions: skipping symlink target", {
            name: entry.name,
            error: String(e),
          });
          continue;
        }
      }

      const fullPath = path.join(dir, entry.name);
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
      dir,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function getBuiltinExtensionsDir(): string {
  const cliPath = config.piCliPath;
  // Resolve symlinks — .bin/pi is a symlink to ../@dyyz1993/pi-coding-agent/dist/cli.js
  // Without realpathSync, path.resolve would go up from .bin/ instead of dist/
  const resolvedCliPath = realpathSync(cliPath);
  // cli.js is at <pkg>/dist/cli.js — go up 2 levels to reach package root
  const pkgRoot = path.resolve(resolvedCliPath, "..", "..");

  // Priority 1: yalc / node_modules layout — <root>/node_modules/@dyyz1993/pi-coding-agent/dist/cli.js
  const nmPkgDir = path.join(path.resolve(pkgRoot, "..", ".."), "@dyyz1993", "pi-coding-agent");
  if (existsSync(path.join(nmPkgDir, "dist", "extensions"))) {
    return path.join(nmPkgDir, "dist", "extensions");
  }
  if (existsSync(path.join(nmPkgDir, "src", "extensions"))) {
    return path.join(nmPkgDir, "src", "extensions");
  }

  // Priority 2: fork source layout — <pkg>/dist/cli.js with extensions at <pkg>/extensions/
  const forkExtDir = path.join(pkgRoot, "extensions");
  if (existsSync(forkExtDir)) {
    return forkExtDir;
  }

  // Priority 3: standard layout — <pkg>/dist/extensions or <pkg>/src/extensions
  const srcExists = existsSync(path.join(pkgRoot, "src"));
  return path.join(pkgRoot, srcExists ? "src" : "dist", "extensions");
}

function discoverExtensionArgs(): string[] {
  const extensionPaths: string[] = [];

  const userExtDir = config.piExtensionsDir;
  if (existsSync(userExtDir)) {
    scanExtensionDir(userExtDir, extensionPaths);
  } else {
    log.warn("Global extensions directory not found", { extDir: userExtDir });
  }

  const builtinExtDir = getBuiltinExtensionsDir();
  if (existsSync(builtinExtDir)) {
    scanExtensionDir(builtinExtDir, extensionPaths);
  }

  log.info("Discovered extensions", {
    userDir: userExtDir,
    builtinDir: builtinExtDir,
    count: extensionPaths.length,
  });
  for (const p of extensionPaths) {
    log.info("  → extension:", { path: p });
  }
  return extensionPaths.flatMap((p) => ["--extension", p]);
}

const EXTENSION_ARGS = ["--no-extensions", ...discoverExtensionArgs()];
const TIER_KEYS = ["fast", "pro", "max"] as const;
type TierKey = (typeof TIER_KEYS)[number];

function parseTierModel(tier: TierKey, modelName: string | undefined): {
  provider: string;
  modelId: string;
} {
  if (!modelName) {
    throw new Error(`Tier "${tier}" is not configured`);
  }

  const [provider, ...modelParts] = modelName.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    throw new Error(`Invalid tier model mapping: ${tier} -> ${modelName}`);
  }

  return { provider, modelId };
}

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

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
    providerConfig: {
      idleTimeout: `${config.sandboxIdleTimeout ?? 1800}s`,
      enableInternet: true,
    },
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
  return globalSandboxManager.getEndpoint(userId) ?? null;
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
  /** @internal Test access to coordinator handler */
  readonly coordinatorHandler!: CoordinatorHandler;

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

  private evictLRU(currentPoolKey: string): void {
    const totalProcesses = [...this.processByCwd.values()].reduce(
      (sum, pool) => sum + pool.size,
      0,
    );
    if (totalProcesses < AgentProcessManager.MAX_POOL_SIZE) return;

    let oldest: ManagedClient | null = null;
    let oldestPoolKey: string | null = null;

    const currentPool = this.processByCwd.get(currentPoolKey);
    const currentPoolSize = currentPool?.size ?? 0;

    for (const [poolKey, pool] of this.processByCwd) {
      for (const mc of pool) {
        if (mc.info.status === "streaming") continue;
        if (mc.activeBackgroundTools.size > 0) continue;

        const isCurrentProject = poolKey === currentPoolKey;

        if (isCurrentProject && currentPoolSize <= 1) continue;

        if (!oldest) {
          oldest = mc;
          oldestPoolKey = poolKey;
        } else {
          const oldestIsCurrent = oldestPoolKey === currentPoolKey;
          if (!isCurrentProject && oldestIsCurrent) {
            oldest = mc;
            oldestPoolKey = poolKey;
          } else if (
            isCurrentProject === oldestIsCurrent &&
            mc.lastActiveAt < oldest.lastActiveAt
          ) {
            oldest = mc;
            oldestPoolKey = poolKey;
          }
        }
      }
    }

    if (oldest && oldestPoolKey) {
      const sid = oldest._activeSessionId;
      log.info("[evictLRU] evicting idle process", {
        totalBefore: totalProcesses,
        poolKey: oldestPoolKey,
        sessionId: sid,
        isCurrentProject: oldestPoolKey === currentPoolKey,
      });
      oldest.unsubscribe();
      oldest.client.stop().catch(() => {});
      this.clients.delete(sid);
      const pool = this.processByCwd.get(oldestPoolKey);
      if (pool) {
        pool.delete(oldest);
        if (pool.size === 0) {
          this.processByCwd.delete(oldestPoolKey);
        }
      }
    }
  }

  private getPoolKey(projectPath: string, userId?: string): string {
    return config.sandboxEnabled && userId ? `${projectPath}::${userId}` : projectPath;
  }

  private messageReader: SessionMessageReader;
  private eventHandler!: AgentEventHandler;

  getSessionCache(
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
    compactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }>;
    parentById: Map<string, string | null>;
    lineCount: number;
    lastJsonlLeafPointer: string | null;
    byteOffset: number;
    needsIncremental: boolean;
  } | null {
    return this.messageReader.getSessionCache(sessionId, sessionPath);
  }

  setSessionCache(
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
      compactionEntries: Array<{
        entryId: string;
        summary: string;
        tokensBefore?: number;
        timestamp: number;
      }>;
      parentById: Map<string, string | null>;
      lineCount: number;
      lastJsonlLeafPointer: string | null;
      byteOffset?: number;
    },
  ): void {
    return this.messageReader.setSessionCache(sessionId, sessionPath, data);
  }

  clearSessionCache(sessionId?: string): void {
    return this.messageReader.clearSessionCache(sessionId);
  }

  async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{ newEntries: number; totalLines: number }> {
    return this.messageReader.readJsonlFromLine(sessionPath, startLine, messages, customEntries, parentById);
  }

  async readJsonlFromByteOffset(
    sessionPath: string,
    byteOffset: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{
    newEntries: number;
    totalLines: number;
    newByteOffset: number;
    newCompactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }>;
    lastLeafPointer: string | null;
  }> {
    return this.messageReader.readJsonlFromByteOffset(sessionPath, byteOffset, messages, customEntries, parentById);
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
          delegateResult = await this.coordinatorHandler.handleCoordinatorDelegateSync(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
          );
        } else {
          delegateResult = await this.coordinatorHandler.handleCoordinatorDelegate(
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

  constructor(server: RPCServer) {
    this.servers.add(server);
    this.coordinatorHandler = new CoordinatorHandler({
      start: (sessionId, projectPath, sessionPath, options) =>
        this.start(sessionId, projectPath, sessionPath, options as Record<string, unknown>),
      stop: (sessionId) => this.stop(sessionId),
      send: (sessionId, content) => this.send(sessionId, content),
      steer: (sessionId, content) => this.steer(sessionId, content),
      followUp: (sessionId, content) => this.followUp(sessionId, content),
      broadcastEvent: (method, params, meta) => this.broadcastEvent(method, params, meta),
      setSessionName: (sessionId, name) => this.setSessionName(sessionId, name),
      switchAgent: (sessionId, agentName) => this.switchAgent(sessionId, agentName),
      getState: (sessionId) => this.getState(sessionId),
      getStatus: (sessionId) => this.getStatus(sessionId),
      getContextUsage: (sessionId) => this.getContextUsage(sessionId),
      getActiveManaged: (sessionId) => this.getActiveManaged(sessionId) ?? undefined,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      clients: this.clients,
      processByCwd: this.processByCwd,
      isStartInProgress: () => this._startInProgress,
      queueDelegateRequest: (args) =>
        new Promise<unknown>((resolve) => {
          this._pendingDelegateRequests.push({ ...args, resolve });
        }),
    });
    this.messageReader = new SessionMessageReader({
      getActiveManaged: (sessionId) => this.getActiveManaged(sessionId) ?? undefined,
      resolveSessionPath: (sessionId) => this.resolveSessionPath(sessionId),
      _getSandboxUserId: (sessionId) => this._getSandboxUserId(sessionId) ?? undefined,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      clients: this.clients,
      getSandboxManager: () => globalSandboxManager,
      leafIds: this.leafIds,
    });
    this.eventHandler = new AgentEventHandler({
      broadcastEvent: (method, params, meta) => this.broadcastEvent(method, params, meta),
      broadcastSessionStatus: (sessionId, status) => this.broadcastSessionStatus(sessionId, status),
      emitAgentEvent: (sessionId, event) => this.emitAgentEvent(sessionId, event as SanitizedEvent),
      getActiveManaged: (sessionId) => this.getActiveManaged(sessionId) ?? undefined,
      findParentSession: (sessionId) => this.coordinatorHandler.findParentSession(sessionId) ?? undefined,
      clients: this.clients,
      lastLspState: this.lastLspState,
      leafIds: this.leafIds,
      syncDelegateResolvers: this.coordinatorHandler.syncDelegateResolvers as AgentEventHandlerDeps["syncDelegateResolvers"],
      syncDelegateLastText: this.coordinatorHandler.syncDelegateLastText,
      subagentSyncChildren: this.coordinatorHandler.subagentSyncChildren,
      parentChildMap: this.coordinatorHandler.parentChildMap,
      delegateReplyCount: this.coordinatorHandler.delegateReplyCount,
      delegateCreatedAt: this.coordinatorHandler.delegateCreatedAt,
    });
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
  ): Promise<{ agentId: string; status: "started" | "already_running" | "switched" }> {
    const tStart = performance.now();

    if (this._startInProgress) {
      // Wait for the in-progress start to finish, then check if client exists
      log.warn("[start] reentrant call, waiting for first start to complete", { sessionId });
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!this._startInProgress) break;
      }
      const existingAfter = this.getActiveManaged(sessionId);
      if (existingAfter) {
        return { agentId: sessionId, status: "already_running" };
      }
      // First start may have failed or was for a different session — fall through and retry
      log.warn("[start] first start did not produce client, proceeding", { sessionId });
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

    // ── Process pool: reuse existing process for same cwd ──
    const reusePoolKey = this.getPoolKey(projectPath, options?.userId);
    const pool = this.processByCwd.get(reusePoolKey);
    if (pool && pool.size > 0) {
      const pooled = [...pool][pool.size - 1];
      const oldSessionId = pooled._activeSessionId;
      const tSwitch = performance.now();
      try {
        perfLog.info("[start] reusing pooled process", {
          sessionId,
          projectPath,
          oldSessionId,
        });
        const result = await Promise.race([
          pooled.client.switchSession(sessionPath),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("switchSession timed out after 15s")), 15000),
          ),
        ]);
        if (!result.cancelled) {
          this.clients.delete(oldSessionId);
          pooled._activeSessionId = sessionId;
          pooled.info = {
            sessionId,
            projectPath,
            sessionPath,
            status: "idle",
          };
          this.clients.set(sessionId, pooled);
          this.sessionPaths.set(sessionId, sessionPath);
          this.sessionProjectPaths.set(sessionId, projectPath);
          perfLog.info("[start] switchSession done", {
            sessionId,
            oldSessionId,
            totalMs: Math.round(performance.now() - tSwitch),
          });
          return { agentId: sessionId, status: "switched" };
        }
        perfLog.info("[start] switchSession cancelled by extension, creating new process");
      } catch (err: unknown) {
        const switchMs = Math.round(performance.now() - tSwitch);
        perfLog.info("[start] switchSession failed, killing pooled process", {
          sessionId,
          oldSessionId,
          switchMs,
          error: err instanceof Error ? err.message : String(err),
        });
        this.processByCwd.delete(projectPath);
        this.clients.delete(oldSessionId);
        try {
          pooled.unsubscribe();
        } catch (e) {
          log.debug("start: failed to unsubscribe old pooled process", { error: String(e) });
        }
        try {
          await pooled.client.stop();
        } catch (e) {
          log.debug("start: failed to stop old pooled process client", { error: String(e) });
        }
      }
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

  async send(
    sessionId: string,
    content: string,
    images?: ImageContent[],
  ): Promise<boolean> {
    let managed = this.getActiveManaged(sessionId);
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) {
      log.warn("send: no client after ensure", { sessionId });
      return false;
    }
    managed.lastActiveAt = Date.now();
    managed.client.prompt(content, images).catch(async (err: Error) => {
      log.warn("prompt error", { err: err.message });
      if (!managed || !(await this.isClientAlive(sessionId, managed))) {
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
    images?: ImageContent[],
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
    images?: ImageContent[],
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

  async stop(sessionId: string, crashReason?: string): Promise<boolean> {
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

    // Cascade stop delegated children + clean up coordinator tracking
    const { childSessionIds } = this.coordinatorHandler.cleanupStoppedSession(sessionId);
    for (const childId of childSessionIds) {
      this.stop(childId);
    }

    // Sync leafId before unsubscribe closes the connection
    try {
      const treeResult = await withTimeout(
        managed.client.getTreeWithLeaf(),
        3_000,
        "getTreeWithLeaf-stop",
      );
      if (treeResult.leafId) {
        this.leafIds.set(sessionId, treeResult.leafId);
      }
    } catch {
      // Best effort — process may already be unresponsive
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

  async getState(sessionId: string): Promise<{
    model?: {
      id: string;
      name?: string;
      api?: string;
      provider?: string;
      reasoning?: boolean;
      contextWindow: number;
      maxTokens: number;
    };
    thinkingLevel?: string;
    isStreaming: boolean;
    isCompacting: boolean;
    steeringMode?: string;
    followUpMode?: string;
    messageCount: number;
    streamingMessage?: AssistantMessage;
    activeToolExecutions: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
  } | null> {
    let managed = this.getActiveManaged(sessionId);
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) return null;

    try {
      const state = await withTimeout(managed.client.getState(), 10_000, "getState");
      const stateWithStreaming = state as typeof state & {
        streamingMessage?: AssistantMessage;
        activeToolExecutions?: Array<{
          toolCallId: string;
          toolName: string;
          args?: unknown;
          startedAt?: number;
        }>;
      };
      const model = state.model;
      const stateAny = state as unknown as Record<string, unknown>;
      return {
        model: model
          ? {
              id: String(model.id ?? ""),
              name: model.name ? String(model.name) : undefined,
              api: stateAny.api ? String(stateAny.api) : undefined,
              provider: model.provider ? String(model.provider) : undefined,
              reasoning: Boolean(model.reasoning),
              contextWindow: Number(model.contextWindow ?? 0),
              maxTokens: Number(model.maxTokens ?? 0),
            }
          : undefined,
        thinkingLevel: state.thinkingLevel ? String(state.thinkingLevel) : undefined,
        isStreaming: Boolean(state.isStreaming),
        isCompacting: Boolean(state.isCompacting),
        steeringMode: stateAny.steeringMode ? String(stateAny.steeringMode) : undefined,
        followUpMode: stateAny.followUpMode ? String(stateAny.followUpMode) : undefined,
        messageCount: Number(state.messageCount ?? 0),
        streamingMessage: stateWithStreaming.streamingMessage,
        activeToolExecutions: stateWithStreaming.activeToolExecutions ?? [],
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
    return this.messageReader.getMessages(sessionId, sessionPath);
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
    return this.messageReader.getFullMessages(sessionId, sessionPath, options);
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
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) return [];
    return managed.client.getAvailableModels().catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getAvailableModels error, checking if CLI is alive", {
        sessionId,
        err: msg,
      });
      if (!managed || !(await this.isClientAlive(sessionId, managed))) {
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
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) throw new Error("Client not found");
    return withTimeout(managed.client.setModel(provider, modelId), 15_000, "setModel");
  }

  async switchTier(
    sessionId: string,
    tier: TierKey,
  ): Promise<{ provider: string; id: string; tier: TierKey }> {
    if (!TIER_KEYS.includes(tier)) {
      throw new Error(`Invalid tier "${tier}". Valid tiers are: fast, pro, max`);
    }

    const { models } = await this.getTierModels(sessionId);
    const { provider, modelId } = parseTierModel(tier, models[tier]);
    const model = await this.setModel(sessionId, provider, modelId);
    return { ...model, tier };
  }

  async cycleModel(sessionId: string): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: string;
    isScoped: boolean;
  } | null> {
    let managed = this.getActiveManaged(sessionId);
    managed ??= await this.ensureManagedClient(sessionId);
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

  async setPermissionMode(sessionId: string, mode: string): Promise<{ mode: string }> {
    let managed = this.getActiveManaged(sessionId);
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) throw new Error("Client not found");
    return withTimeout(
      managed.client.setPermissionMode(
        mode as Parameters<typeof managed.client.setPermissionMode>[0],
      ),
      15_000,
      "setPermissionMode",
    );
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
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) return { tokens: null, contextWindow: 0, percent: null };
    return managed.client.getContextUsage().catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getContextUsage error, checking if CLI is alive", {
        sessionId,
        err: msg,
      });
      if (!managed || !(await this.isClientAlive(sessionId, managed))) {
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
    managed ??= await this.ensureManagedClient(sessionId);
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
    managed ??= await this.ensureManagedClient(sessionId);
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
    managed ??= await this.ensureManagedClient(sessionId);
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
    managed ??= await this.ensureManagedClient(sessionId);
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
    const result = (await withTimeout(managed.client.fork(entryId, options), 60_000, "fork")) as {
      text: string;
      cancelled: boolean;
      newSessionFile?: string;
      newSessionId?: string;
    };
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
    return this.messageReader.navigateTree(sessionId, targetId, options);
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
    return this.messageReader.getTree(sessionId);
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
      // Wait up to 3s for agent process to finish starting (spawn takes ~1.5s)
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        managed = this.getActiveManaged(sessionId);
        if (managed) break;
      }
    }
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) throw new Error("Client not found");
    const ch = managed.client.channel(channelName);
    return ch.call(method, params);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    this.eventHandler.handleEvent(sessionId, event);
  }

  private async handleCoordinatorCall(
    sessionId: string,
    data: unknown,
    channelName: string,
  ): Promise<void> {
    return this.coordinatorHandler.handleCoordinatorCall(sessionId, data, channelName);
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
    return managed !== null;
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
