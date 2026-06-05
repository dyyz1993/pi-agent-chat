import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  ChannelDataEvent,
} from "../modules/agent";
import type { RpcClientAPI, ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";
import type { TreeEntry } from "../modules/agent";
import { performance } from "perf_hooks";

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
  createAgentClientApiAdapter,
  type AgentClientApiAdapter,
} from "./agent-client-api-adapter";
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
import { getStateOperation } from "./agent-client-state-operations";
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
import {
  ensureManagedClientOperation,
  findSandboxUserIdForSession,
} from "./agent-managed-client-operations";
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
  cloneOperation,
  exportHtmlOperation,
  forkOperation,
  getBatchDiffsOperation,
  getFileDiffOperation,
  getForkMessagesOperation,
  getModifiedFilesOperation,
  newSessionOperation,
  previewRollbackOperation,
  restoreFilesFromSnapshotOperation,
} from "./agent-client-history-operations";
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
  declare getCommands: AgentClientApiAdapter["getCommands"];
  declare getSessionStats: AgentClientApiAdapter["getSessionStats"];
  declare getMessages: AgentClientApiAdapter["getMessages"];
  declare getFullMessages: AgentClientApiAdapter["getFullMessages"];
  declare getAvailableModels: AgentClientApiAdapter["getAvailableModels"];
  declare setModel: AgentClientApiAdapter["setModel"];
  declare switchTier: AgentClientApiAdapter["switchTier"];
  declare cycleModel: AgentClientApiAdapter["cycleModel"];
  declare setThinkingLevel: AgentClientApiAdapter["setThinkingLevel"];
  declare cycleThinkingLevel: AgentClientApiAdapter["cycleThinkingLevel"];
  declare compact: AgentClientApiAdapter["compact"];
  declare setAutoCompaction: AgentClientApiAdapter["setAutoCompaction"];
  declare setAutoRetry: AgentClientApiAdapter["setAutoRetry"];
  declare abortRetry: AgentClientApiAdapter["abortRetry"];
  declare setSteeringMode: AgentClientApiAdapter["setSteeringMode"];
  declare setFollowUpMode: AgentClientApiAdapter["setFollowUpMode"];
  declare setPermissionMode: AgentClientApiAdapter["setPermissionMode"];
  declare getActiveTools: AgentClientApiAdapter["getActiveTools"];
  declare setActiveTools: AgentClientApiAdapter["setActiveTools"];
  declare getQueue: AgentClientApiAdapter["getQueue"];
  declare clearQueue: AgentClientApiAdapter["clearQueue"];
  declare getExtensions: AgentClientApiAdapter["getExtensions"];
  declare getSkills: AgentClientApiAdapter["getSkills"];
  declare reload: AgentClientApiAdapter["reload"];
  declare getTools: AgentClientApiAdapter["getTools"];
  declare getMcpServers: AgentClientApiAdapter["getMcpServers"];
  declare toggleMcpServer: AgentClientApiAdapter["toggleMcpServer"];
  declare restartMcpServer: AgentClientApiAdapter["restartMcpServer"];
  declare getContextUsage: AgentClientApiAdapter["getContextUsage"];
  declare getTierModels: AgentClientApiAdapter["getTierModels"];
  declare setTierModels: AgentClientApiAdapter["setTierModels"];
  declare getAgents: AgentClientApiAdapter["getAgents"];
  declare switchAgent: AgentClientApiAdapter["switchAgent"];
  declare getCurrentAgent: AgentClientApiAdapter["getCurrentAgent"];
  declare getAgentDetail: AgentClientApiAdapter["getAgentDetail"];
  declare getAllTools: AgentClientApiAdapter["getAllTools"];
  declare getSystemPrompt: AgentClientApiAdapter["getSystemPrompt"];
  declare getLatestAgentChange: AgentClientApiAdapter["getLatestAgentChange"];
  declare getSettings: AgentClientApiAdapter["getSettings"];
  declare setSettings: AgentClientApiAdapter["setSettings"];
  declare setSessionName: AgentClientApiAdapter["setSessionName"];
  declare getLastAssistantText: AgentClientApiAdapter["getLastAssistantText"];

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
    Object.assign(
      this,
      createAgentClientApiAdapter({
        getActiveManaged: (id) => this.getActiveManaged(id),
        ensureManagedClient: (id) => this.ensureManagedClient(id),
        isClientAlive: (id, managed) => this.isClientAlive(id, managed),
        cleanupDeadClient: (id, reason) => this.cleanupDeadClient(id, reason),
        resolveSessionPath: (id) => this.resolveSessionPath(id),
        buildMessagesFromJsonl: (entries, leafId) =>
          this.buildMessagesFromJsonl(entries, leafId),
        leafIds: this.leafIds,
        getSandboxUserId: (id) => this._getSandboxUserId(id),
        broadcastEvent: (eventName, payload, metadata) =>
          this.broadcastEvent(eventName, payload, metadata),
      }),
    );
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
    return ensureManagedClientOperation({
      sessionId,
      getActiveManaged: (id) => this.getActiveManaged(id),
      sessionProjectPaths: this.sessionProjectPaths,
      sessionPaths: this.sessionPaths,
      findSessionById,
      sandboxEnabled: !!config.sandboxEnabled,
      getSandboxUserId: (id) => this._getSandboxUserId(id),
      start: (id, projectPath, sessionPath, startOptions) =>
        this.start(id, projectPath, sessionPath, startOptions),
    });
  }

  private _getSandboxUserId(sessionId: string): string | null {
    return findSandboxUserIdForSession({
      sessionId,
      sandboxEnabled: !!config.sandboxEnabled,
      processByCwd: this.processByCwd,
      clients: this.clients,
    });
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
