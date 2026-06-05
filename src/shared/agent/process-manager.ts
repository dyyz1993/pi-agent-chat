import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  AgentMessageForUI,
  ChannelDataEvent,
} from "../modules/agent";
import type { RpcClientAPI, ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";
import type { TreeEntry } from "../modules/agent";
import { performance } from "perf_hooks";

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
import { findSessionById } from "../lib/session-scanner";
import {
  compactHoldEventsForReplay,
  type SanitizedEvent,
} from "./hold-events";
import {
  SessionMessageCache,
  type SessionCacheData,
  type SessionCacheHit,
  type SessionCustomEntry,
  type SessionMessageEntry,
} from "./session-message-cache";
import {
  type TierKey,
} from "./agent-runtime-config";
import {
  cycleModelOperation,
  cycleThinkingLevelOperation,
  getAvailableModelsOperation,
  setModelOperation,
  setThinkingLevelOperation,
  switchTierOperation,
} from "./agent-client-model-operations";
import {
  getCommandsOperation,
  getSessionStatsOperation,
  getStateOperation,
} from "./agent-client-state-operations";
import {
  abortOperation,
  followUpOperation,
  sendPromptOperation,
  steerOperation,
} from "./agent-client-lifecycle-operations";
import {
  createRpcClient,
  getSandboxEndpoint,
  getSandboxManager,
  initSandboxManager,
} from "./agent-runtime-client";
import { startAgentClientOperation } from "./agent-start-operations";
import { stopAgentClientOperation } from "./agent-stop-operations";
import {
  type CachedLspState,
} from "./agent-channel-state";
import {
  handleBashChannelDataOperation,
  handleLspChannelDataOperation,
  handleMemoryChannelDataOperation,
  handleRulesChannelDataOperation,
  handleSubagentChannelDataOperation,
  handleSupervisorChannelDataOperation,
  handleTodoChannelDataOperation,
} from "./agent-channel-handlers";
import {
  addToProcessPool,
  makeProcessPoolKey,
  removeFromProcessPool,
  selectLruEvictionCandidate,
} from "./agent-process-pool";
import {
  getAgentsOperation,
  getCurrentAgentOperation,
  getLatestAgentChangeOperation,
  getTierModelsOperation,
  setTierModelsOperation,
  switchAgentOperation,
} from "./agent-client-command-operations";
import {
  abortRetryOperation,
  clearQueueOperation,
  compactOperation,
  getActiveToolsOperation,
  getContextUsageOperation,
  getExtensionsOperation,
  getMcpServersOperation,
  getQueueOperation,
  getSkillsOperation,
  getToolsOperation,
  reloadOperation,
  restartMcpServerOperation,
  setActiveToolsOperation,
  setAutoCompactionOperation,
  setAutoRetryOperation,
  setFollowUpModeOperation,
  setPermissionModeOperation,
  setSteeringModeOperation,
  toggleMcpServerOperation,
} from "./agent-client-session-operations";
import {
  cloneOperation,
  exportHtmlOperation,
  forkOperation,
  getBatchDiffsOperation,
  getFileDiffOperation,
  getForkMessagesOperation,
  getLastAssistantTextOperation,
  getModifiedFilesOperation,
  newSessionOperation,
  previewRollbackOperation,
  restoreFilesFromSnapshotOperation,
} from "./agent-client-history-operations";
import {
  getFullMessagesOperation,
  getMessagesOperation,
} from "./agent-client-message-operations";
import { registerAgentChannels } from "./agent-channel-registration";
import { handleAgentEventOperation } from "./agent-event-routing";
import {
  clearDelegateTracking,
  removeDelegateChild,
} from "./coordinator-session-state";
import { findCoordinatorResponseManaged } from "./coordinator-response-routing";
import { handleCoordinatorCallOperation } from "./coordinator-call-dispatcher";
import {
  handleCoordinatorDelegateOperation,
  handleCoordinatorDelegateForkOperation,
  handleCoordinatorDelegateListOperation,
  handleCoordinatorDelegateSendOperation,
  handleCoordinatorDelegateSyncOperation,
  handleCoordinatorDelegateStatusOperation,
  handleCoordinatorDelegateStopOperation,
} from "./coordinator-delegate-operations";
import {
  getTreeOperation,
  navigateTreeOperation,
  readJsonlTreeEntriesOperation,
} from "./agent-tree-navigation-operations";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

export { getSandboxEndpoint, getSandboxManager, initSandboxManager };

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

export class AgentProcessManager {
  private clients = new Map<string, ManagedClient>();
  /** CWD-based process tracking: projectPath → set of ManagedClients for that project */
  private processByCwd = new Map<string, Set<ManagedClient>>();
  private servers = new Set<RPCServer>();
  /** Guard: prevents recursive start() via coordinator session_delegate */
  private _startInProgress = false;
  /** Serializes explicit start/switch operations so callers never observe a fake ready state. */
  private _startQueue: Promise<void> = Promise.resolve();
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
  private lastLspState = new Map<string, CachedLspState>();
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
    addToProcessPool(this.processByCwd, poolKey, managed);
  }

  private removeFromPool(poolKey: string, managed: ManagedClient): void {
    removeFromProcessPool(this.processByCwd, poolKey, managed);
  }

  private evictLRU(currentPoolKey: string): void {
    const candidate = selectLruEvictionCandidate(
      this.processByCwd,
      currentPoolKey,
      AgentProcessManager.MAX_POOL_SIZE,
    );
    if (!candidate) return;

    const { poolKey, managed, totalProcesses } = candidate;
    const sid = managed._activeSessionId;
    log.info("[evictLRU] evicting idle process", {
      totalBefore: totalProcesses,
      poolKey,
      sessionId: sid,
      isCurrentProject: poolKey === currentPoolKey,
    });
    managed.unsubscribe();
    managed.client.stop().catch(() => {});
    this.clients.delete(sid);
    this.removeFromPool(poolKey, managed);
  }

  private getPoolKey(projectPath: string, userId?: string): string {
    return makeProcessPoolKey(projectPath, userId, Boolean(config.sandboxEnabled));
  }

  private sessionMessageCache = new SessionMessageCache();

  /**
   * Get cached session data. Three outcomes:
   * 1. Exact match (file unchanged) → return cached data
   * 2. File grew → return cached data + mark for incremental append
   * 3. No cache / file shrunk / file gone → return null
   */
  getSessionCache(
    sessionId: string,
    sessionPath: string,
  ): SessionCacheHit | null {
    return this.sessionMessageCache.get(sessionId, sessionPath);
  }

  setSessionCache(sessionId: string, sessionPath: string, data: SessionCacheData): void {
    this.sessionMessageCache.set(sessionId, sessionPath, data);
  }

  clearSessionCache(sessionId?: string): void {
    this.sessionMessageCache.clear(sessionId);
  }

  /**
   * Read JSONL from a specific physical line number onwards and append results.
   * Returns { newEntries: number of new parsed entries, totalLines: total physical lines in file }
   */
  async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: SessionMessageEntry[],
    customEntries: SessionCustomEntry[],
    parentById: Map<string, string | null>,
  ): Promise<{ newEntries: number; totalLines: number }> {
    return this.sessionMessageCache.readJsonlFromLine(
      sessionPath,
      startLine,
      messages,
      customEntries,
      parentById,
    );
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
  ): Promise<{ agentId: string; status: "started" | "already_running" | "switched" }> {
    const previousStart = this._startQueue;
    let releaseStart: () => void = () => {};
    this._startQueue = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    await previousStart;
    this._startInProgress = true;

    try {
      return await startAgentClientOperation({
        sessionId,
        projectPath,
        sessionPath,
        startOptions: options,
        clients: this.clients,
        processByCwd: this.processByCwd,
        sessionPaths: this.sessionPaths,
        sessionProjectPaths: this.sessionProjectPaths,
        getPoolKey: (cwd, userId) => this.getPoolKey(cwd, userId),
        evictLRU: (poolKey) => this.evictLRU(poolKey),
        addToPool: (poolKey, managed) => this.addToPool(poolKey, managed),
        createRpcClient,
        registerAgentChannels,
        handleEvent: (activeSessionId, event) => {
          this.handleEvent(activeSessionId, event);
        },
        handleCoordinatorCall: (activeSessionId, data, channelName) => {
          this.handleCoordinatorCall(activeSessionId, data, channelName);
        },
        broadcastSessionStatus: (activeSessionId, status) => {
          this.broadcastSessionStatus(activeSessionId, status);
        },
      });
    } finally {
      this._startInProgress = false;
      releaseStart();
      this._drainPendingDelegates();
    }
  }

  async replayHoldEvents(sessionId: string): Promise<{ replayed: number }> {
    const t0 = performance.now();
    const managed = this.getActiveManaged(sessionId);
    if (!managed) {
      perfLog.info("[replayHoldEvents] no client", { sessionId, totalMs: 0 });
      return { replayed: 0 };
    }
    const heldEvents = managed.info.holdEvents as SanitizedEvent[];
    const events = compactHoldEventsForReplay(heldEvents);
    if (events.length !== heldEvents.length) {
      managed.info.holdEvents = events;
    }
    for (const evt of events) {
      await this.emitAgentEvent(sessionId, evt);
    }
    const totalMs = Math.round(performance.now() - t0);
    perfLog.info("[replayHoldEvents] done", {
      sessionId,
      held: heldEvents.length,
      replayed: events.length,
      compacted: heldEvents.length - events.length,
      totalMs,
    });
    return { replayed: events.length };
  }

  async send(
    sessionId: string,
    content: string,
    images?: import("@dyyz1993/pi-ai").ImageContent[],
  ): Promise<boolean> {
    return sendPromptOperation({
      sessionId,
      content,
      images,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
      isClientAlive: (id, managed) => this.isClientAlive(id, managed),
      cleanupDeadClient: (id, reason) => this.cleanupDeadClient(id, reason),
      emitAgentEnd: (id) => this.emitAgentEvent(id, { type: "agent_end" } as SanitizedEvent),
    });
  }

  steer(
    sessionId: string,
    content: string,
    images?: import("@dyyz1993/pi-ai").ImageContent[],
  ): boolean {
    return steerOperation({
      sessionId,
      content,
      images,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  followUp(
    sessionId: string,
    content: string,
    images?: import("@dyyz1993/pi-ai").ImageContent[],
  ): boolean {
    return followUpOperation({
      sessionId,
      content,
      images,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async abort(sessionId: string): Promise<boolean> {
    return abortOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      broadcastIdle: (id) => this.broadcastSessionStatus(id, "idle"),
      emitAgentEvent: (id, event) => this.emitAgentEvent(id, event),
    });
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
    return stopAgentClientOperation({
      sessionId,
      crashReason,
      getActiveManaged: (id) => this.getActiveManaged(id),
      clients: this.clients,
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
      syncDelegateResolvers: this.syncDelegateResolvers,
      subagentSyncChildren: this.subagentSyncChildren,
      syncDelegateLastText: this.syncDelegateLastText,
      leafIds: this.leafIds,
      getPoolKey: (cwd, userId) => this.getPoolKey(cwd, userId),
      removeFromPool: (poolKey, managed) => this.removeFromPool(poolKey, managed),
      stopChild: (id) => this.stop(id),
      emitAgentEvent: (id, event) => this.emitAgentEvent(id, event),
      deleteLspState: (id) => {
        this.lastLspState.delete(id);
      },
      clearSessionCache: (id) => this.clearSessionCache(id),
    });
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
   * If the managed client was GC'd or the backend restarted, rebuild it
   * using persisted session/project metadata.
   */
  private async ensureManagedClient(sessionId: string): Promise<ManagedClient | null> {
    const existing = this.getActiveManaged(sessionId);
    if (existing) return existing;

    let projectPath = this.sessionProjectPaths.get(sessionId);
    let sessionPath = this.sessionPaths.get(sessionId);
    if (!projectPath || !sessionPath) {
      const session = await findSessionById(sessionId);
      if (session) {
        projectPath = session.projectPath;
        sessionPath = session.sessionPath;
        this.sessionProjectPaths.set(sessionId, projectPath);
        this.sessionPaths.set(sessionId, sessionPath);
      }
    }

    if (!projectPath || !sessionPath) {
      log.warn("[ensureManagedClient] session metadata not found", { sessionId });
      return null;
    }

    const userId = config.sandboxEnabled ? (this._getSandboxUserId(sessionId) ?? sessionId) : undefined;

    log.info("[ensureManagedClient] rebuilding managed client", {
      sessionId,
      projectPath,
      sandbox: !!config.sandboxEnabled,
      userId,
    });

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
    streamingMessage?: unknown;
  } | null> {
    return getStateOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
      isClientAlive: (id, managed) => this.isClientAlive(id, managed),
      cleanupDeadClient: (id, reason) => this.cleanupDeadClient(id, reason),
    });
  }

  async getCommands(
    sessionId: string,
  ): Promise<
    Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>
  > {
    return getCommandsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getSessionStats(sessionId: string): Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null> {
    return getSessionStatsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      isClientAlive: (id, managed) => this.isClientAlive(id, managed),
      cleanupDeadClient: (id, reason) => this.cleanupDeadClient(id, reason),
    });
  }

  async getMessages(
    sessionId: string,
    sessionPath?: string,
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }> {
    const sandboxManager = getSandboxManager();
    return getMessagesOperation({
      sessionId,
      sessionPath,
      getActiveManaged: (id) => this.getActiveManaged(id),
      resolveSessionPath: (id) => this.resolveSessionPath(id),
      readJsonlEntries: readJsonlTreeEntriesOperation,
      buildMessagesFromJsonl: (entries, leafId) => this.buildMessagesFromJsonl(entries, leafId),
      leafIds: this.leafIds,
      readSandboxFile:
        sandboxManager
          ? async (pathToRead) => {
              const userId = this._getSandboxUserId(sessionId);
              return userId ? sandboxManager.execInSandbox(userId, `cat ${pathToRead}`) : "";
            }
          : undefined,
    });
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
    const sandboxManager = getSandboxManager();
    return getFullMessagesOperation({
      sessionId,
      sessionPath,
      pagination: options,
      getActiveManaged: (id) => this.getActiveManaged(id),
      resolveSessionPath: (id) => this.resolveSessionPath(id),
      leafIds: this.leafIds,
      readSandboxFile: sandboxManager
        ? async (pathToRead) => {
            const userId = this._getSandboxUserId(sessionId);
            return userId ? sandboxManager.execInSandbox(userId, `cat ${pathToRead}`) : "";
          }
        : undefined,
    });
  }

  async getAvailableModels(
    sessionId: string,
  ): Promise<Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>> {
    return getAvailableModelsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
      isClientAlive: (id, managed) => this.isClientAlive(id, managed),
      cleanupDeadClient: (id, reason) => this.cleanupDeadClient(id, reason),
    });
  }

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<{ provider: string; id: string }> {
    return setModelOperation({
      sessionId,
      provider,
      modelId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
  }

  async switchTier(
    sessionId: string,
    tier: TierKey,
  ): Promise<{ provider: string; id: string; tier: TierKey }> {
    return switchTierOperation({
      tier,
      getTierModels: () => this.getTierModels(sessionId),
      setModel: (provider, modelId) => this.setModel(sessionId, provider, modelId),
    });
  }

  async cycleModel(sessionId: string): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: string;
    isScoped: boolean;
  } | null> {
    return cycleModelOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    await setThinkingLevelOperation({
      sessionId,
      level,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async cycleThinkingLevel(sessionId: string): Promise<{ level: string } | null> {
    return cycleThinkingLevelOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async compact(
    sessionId: string,
    customInstructions?: string,
  ): Promise<{ summary: string; tokensBefore: number }> {
    return compactOperation({
      sessionId,
      customInstructions,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    await setAutoCompactionOperation({
      sessionId,
      enabled,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    await setAutoRetryOperation({
      sessionId,
      enabled,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async abortRetry(sessionId: string): Promise<void> {
    await abortRetryOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    await setSteeringModeOperation({
      sessionId,
      mode,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    await setFollowUpModeOperation({
      sessionId,
      mode,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<{ mode: string }> {
    return setPermissionModeOperation({
      sessionId,
      mode,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
  }

  async getActiveTools(sessionId: string): Promise<{ toolNames: string[] }> {
    return getActiveToolsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async setActiveTools(sessionId: string, toolNames: string[]): Promise<void> {
    await setActiveToolsOperation({
      sessionId,
      toolNames,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    return getQueueOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async clearQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    return clearQueueOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
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
    return getExtensionsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return getSkillsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async reload(sessionId: string): Promise<void> {
    await reloadOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getTools(
    sessionId: string,
  ): Promise<{ tools: Array<{ name: string; label: string; description: string }> }> {
    return getToolsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getMcpServers(sessionId: string): Promise<{ servers: McpServerInfo[] }> {
    return getMcpServersOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async toggleMcpServer(
    sessionId: string,
    name: string,
    enabled: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    return toggleMcpServerOperation({
      sessionId,
      name,
      enabled,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async restartMcpServer(
    sessionId: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> {
    return restartMcpServerOperation({
      sessionId,
      name,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getContextUsage(
    sessionId: string,
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null }> {
    return getContextUsageOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
      isClientAlive: (id, managed) => this.isClientAlive(id, managed),
      cleanupDeadClient: (id, reason) => this.cleanupDeadClient(id, reason),
    });
  }

  async getTierModels(sessionId: string): Promise<{ models: Record<string, string> }> {
    return getTierModelsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
  }

  async setTierModels(sessionId: string, models: Record<string, string>): Promise<{ ok: boolean }> {
    return setTierModelsOperation({
      sessionId,
      models,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return getAgentsOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
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
    return switchAgentOperation({
      sessionId,
      agentName,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
  }

  async getCurrentAgent(sessionId: string): Promise<{ agentName: string | null }> {
    return getCurrentAgentOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      ensureManagedClient: (id) => this.ensureManagedClient(id),
    });
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
    return getLatestAgentChangeOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return getLastAssistantTextOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getForkMessages(
    sessionId: string,
  ): Promise<{ messages: Array<{ entryId: string; text: string }> }> {
    return getForkMessagesOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return forkOperation({
      sessionId,
      entryId,
      forkOptions: options,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async navigateTree(
    sessionId: string,
    targetId: string,
    options?: { summarize?: boolean; skipFiles?: boolean },
  ): Promise<{ cancelled: boolean; reason?: string }> {
    return navigateTreeOperation({
      sessionId,
      targetId,
      navigateOptions: options,
      getActiveManaged: (id) => this.getActiveManaged(id),
      resolveSessionPath: (id) => this.resolveSessionPath(id),
      leafIds: this.leafIds,
      readJsonlEntries: readJsonlTreeEntriesOperation,
    });
  }

  async previewRollback(
    sessionId: string,
    targetId: string,
  ): Promise<{ restored: string[]; deleted: string[] }> {
    return previewRollbackOperation({
      sessionId,
      targetId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return getModifiedFilesOperation({
      sessionId,
      fromEntryId,
      toEntryId,
      toUserMsgEntryId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return getFileDiffOperation({
      sessionId,
      filePath,
      fromEntryId,
      toEntryId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    return getBatchDiffsOperation({
      sessionId,
      fromEntryId,
      toEntryId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async getTree(sessionId: string): Promise<{ entries: TreeEntry[]; leafId?: string | null }> {
    return getTreeOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      resolveSessionPath: (id) => this.resolveSessionPath(id),
      leafIds: this.leafIds,
      readJsonlEntries: readJsonlTreeEntriesOperation,
    });
  }

  async restoreFilesFromSnapshot(
    sessionId: string,
    snapshotTreeHash: string,
    files?: string[],
  ): Promise<string[]> {
    return restoreFilesFromSnapshotOperation({
      sessionId,
      snapshotTreeHash,
      files,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async clone(sessionId: string): Promise<{ cancelled: boolean }> {
    return cloneOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async newSession(sessionId: string, parentSession?: string): Promise<{ cancelled: boolean }> {
    return newSessionOperation({
      sessionId,
      parentSession,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
  }

  async exportHtml(sessionId: string, outputPath?: string): Promise<{ path: string }> {
    return exportHtmlOperation({
      sessionId,
      outputPath,
      getActiveManaged: (id) => this.getActiveManaged(id),
    });
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
    if (!managed) {
      managed = await this.ensureManagedClient(sessionId);
    }
    if (!managed) throw new Error("Client not found");
    const ch = managed.client.channel(channelName);
    return ch.call(method, params);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    handleAgentEventOperation({
      sessionId,
      event,
      getActiveManaged: (id) => this.getActiveManaged(id),
      clients: this.clients,
      parentChildMap: this.parentChildMap,
      leafIds: this.leafIds,
      syncDelegateResolvers: this.syncDelegateResolvers,
      subagentSyncChildren: this.subagentSyncChildren,
      syncDelegateLastText: this.syncDelegateLastText,
      sandboxEnabled: config.sandboxEnabled,
      broadcastEvent: (eventName, data, filter) => this.broadcastEvent(eventName, data, filter),
      broadcastSessionStatus: (id, status) => this.broadcastSessionStatus(id, status),
      emitAgentEvent: (id, sanitized) => this.emitAgentEvent(id, sanitized),
      handleSubagentChannelData: (id, ch) => {
        this.handleSubagentChannelData(id, ch);
      },
      handleTodoChannelData: (id, ch) => {
        this.handleTodoChannelData(id, ch);
      },
      handleBashChannelData: (id, ch) => {
        this.handleBashChannelData(id, ch);
      },
      handleLspChannelData: (id, ch) => {
        this.handleLspChannelData(id, ch);
      },
      handleRulesChannelData: (id, ch) => {
        this.handleRulesChannelData(id, ch);
      },
      handleMemoryChannelData: (id, ch) => {
        this.handleMemoryChannelData(id, ch);
      },
      handleSupervisorChannelData: (id, ch) => {
        this.handleSupervisorChannelData(id, ch);
      },
    });
  }

  private async handleSubagentChannelData(
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleSubagentChannelDataOperation({
      parentSessionId,
      channelMsg,
      getManagedState: (id) => {
        const managed = this.clients.get(id);
        if (!managed) return null;
        return {
          sessionPath: managed.info.sessionPath,
          activeBackgroundTools: managed.activeBackgroundTools,
        };
      },
      broadcastEvent: (name, payload, filter) => this.broadcastEvent(name, payload, filter),
    });
  }

  private async handleTodoChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleTodoChannelDataOperation({
      sessionId,
      channelMsg,
      broadcastEvent: (name, payload, filter) => this.broadcastEvent(name, payload, filter),
    });
  }

  private async handleBashChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleBashChannelDataOperation({
      sessionId,
      channelMsg,
      getManagedState: (id) => {
        const managed = this.clients.get(id);
        if (!managed) return null;
        return {
          sessionPath: managed.info.sessionPath,
          activeBackgroundTools: managed.activeBackgroundTools,
        };
      },
      broadcastEvent: (name, payload, filter) => this.broadcastEvent(name, payload, filter),
    });
  }

  private async handleSupervisorChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleSupervisorChannelDataOperation({
      sessionId,
      channelMsg,
      broadcastEvent: (name, payload, filter) => this.broadcastEvent(name, payload, filter),
    });
  }

  private async handleLspChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleLspChannelDataOperation({
      sessionId,
      channelMsg,
      getCachedState: (id) => this.lastLspState.get(id),
      setCachedState: (id, state) => this.lastLspState.set(id, state),
    });
  }

  private async handleRulesChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleRulesChannelDataOperation({
      sessionId,
      channelMsg,
      broadcastEvent: (name, payload, filter) => this.broadcastEvent(name, payload, filter),
    });
  }

  private async handleMemoryChannelData(
    sessionId: string,
    channelMsg: ChannelDataEvent,
  ): Promise<void> {
    await handleMemoryChannelDataOperation({
      sessionId,
      channelMsg,
      broadcastEvent: (name, payload, filter) => this.broadcastEvent(name, payload, filter),
    });
  }

  private async handleCoordinatorCall(
    sessionId: string,
    data: unknown,
    channelName: string,
  ): Promise<void> {
    await handleCoordinatorCallOperation({
      sessionId,
      data,
      channelName,
      startInProgress: this._startInProgress,
      broadcastEvent: (eventName, payload, filter) =>
        this.broadcastEvent(eventName, payload, filter),
      queueDelegateRequest: (request) =>
        new Promise<unknown>((resolve) => {
          this._pendingDelegateRequests.push({ ...request, resolve });
        }),
      handleDelegate: (id, msg) => this.handleCoordinatorDelegate(id, msg),
      handleDelegateSend: (msg) => this.handleCoordinatorDelegateSend(msg),
      handleDelegateSync: (id, msg) => this.handleCoordinatorDelegateSync(id, msg),
      handleDelegateStatus: (msg) => this.handleCoordinatorDelegateStatus(msg),
      handleDelegateList: (id) => this.handleCoordinatorDelegateList(id),
      handleDelegateStop: (id, msg) => this.handleCoordinatorDelegateStop(id, msg),
      handleDelegateFork: (id, msg) => this.handleCoordinatorDelegateFork(id, msg),
      handleClearStopped: (msg) => this.handleCoordinatorClearStopped(msg),
      handleRemove: (id, msg) => this.handleCoordinatorRemove(id, msg),
      findResponseManaged: (id) =>
        findCoordinatorResponseManaged({
          active: this.getActiveManaged(id) ?? undefined,
          sessionId: id,
          sessionProjectPaths: this.sessionProjectPaths,
          processByCwd: this.processByCwd,
        }),
    });
  }

  private handleCoordinatorClearStopped(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_clear_stopped" }>,
  ): { cleared: string[] } {
    const targetSessionId = (msg as Record<string, unknown>).sessionId as string | undefined;
    const cleared: string[] = [];
    if (targetSessionId) {
      clearDelegateTracking(this.delegateCreatedAt, this.delegateReplyCount, targetSessionId);
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

    removeDelegateChild(this.parentChildMap, parentSessionId, targetSessionId);
    clearDelegateTracking(this.delegateCreatedAt, this.delegateReplyCount, targetSessionId);
    this.stop(targetSessionId);
    return { removed: true };
  }

  private async handleCoordinatorDelegate(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" | "switched" }> {
    return handleCoordinatorDelegateOperation({
      parentSessionId,
      msg,
      getActiveManaged: (id) => this.getActiveManaged(id),
      start: (id, projectPath, sessionPath, startOptions) =>
        this.start(id, projectPath, sessionPath, startOptions),
      setSessionName: (id, name) => this.setSessionName(id, name),
      send: (id, content) => this.send(id, content),
      broadcastEvent: (eventName, data, filter) => this.broadcastEvent(eventName, data, filter),
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
    });
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
    return handleCoordinatorDelegateSyncOperation({
      parentSessionId,
      msg,
      getActiveManaged: (id) => this.getActiveManaged(id),
      start: (id, projectPath, sessionPath, startOptions) =>
        this.start(id, projectPath, sessionPath, startOptions),
      switchAgent: (id, agentName) => this.switchAgent(id, agentName),
      setSessionName: (id, name) => this.setSessionName(id, name),
      send: (id, content) => this.send(id, content),
      steer: (id, content) => this.steer(id, content),
      stop: (id) => this.stop(id),
      broadcastEvent: (eventName, data, filter) => this.broadcastEvent(eventName, data, filter),
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
      syncDelegateResolvers: this.syncDelegateResolvers,
      subagentSyncChildren: this.subagentSyncChildren,
      syncDelegateLastText: this.syncDelegateLastText,
    });
  }

  private async handleCoordinatorDelegateSend(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
  ): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
    return handleCoordinatorDelegateSendOperation({
      msg,
      clients: this.clients,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      delegateReplyCount: this.delegateReplyCount,
      delegateCreatedAt: this.delegateCreatedAt,
      parentChildMap: this.parentChildMap,
      start: (sessionId, projectPath, sessionPath) => this.start(sessionId, projectPath, sessionPath),
      send: (sessionId, content) => {
        this.send(sessionId, content);
      },
      steer: (sessionId, content) => {
        this.steer(sessionId, content);
      },
      followUp: (sessionId, content) => {
        this.followUp(sessionId, content);
      },
    });
  }

  private async handleCoordinatorDelegateStatus(
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>,
  ): Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }> {
    return handleCoordinatorDelegateStatusOperation({
      msg,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      getStatus: (sessionId) => this.getStatus(sessionId),
      getState: (sessionId) => this.getState(sessionId),
      getContextUsage: (sessionId) => this.getContextUsage(sessionId),
    });
  }

  private handleCoordinatorDelegateList(parentSessionId: string): {
    sessions: Array<{ sessionId: string; status: string; projectPath: string }>;
  } {
    return handleCoordinatorDelegateListOperation({
      parentSessionId,
      parentChildMap: this.parentChildMap,
      clients: this.clients,
    });
  }

  private async handleCoordinatorDelegateStop(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>,
  ): Promise<{ ok: boolean }> {
    return handleCoordinatorDelegateStopOperation({
      parentSessionId,
      msg,
      parentChildMap: this.parentChildMap,
      stop: (sessionId) => this.stop(sessionId),
    });
  }

  private async handleCoordinatorDelegateFork(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" | "switched" }> {
    return handleCoordinatorDelegateForkOperation({
      parentSessionId,
      msg,
      clients: this.clients,
      start: (id, projectPath, sessionPath, startOptions) =>
        this.start(id, projectPath, sessionPath, startOptions),
      setSessionName: (id, name) => this.setSessionName(id, name),
      send: (id, content) => this.send(id, content),
      broadcastEvent: (eventName, data, filter) => this.broadcastEvent(eventName, data, filter),
      parentChildMap: this.parentChildMap,
    });
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
