import type {
  CoordinatorMethodCall,
  CoordinatorChannelEvent,
  DelegateStatusExt,
} from "../modules/coordinator";
import {
  type DelegateChildMap,
  type SyncDelegateResolver,
  clearDelegateTracking,
  canManageDelegateChild,
  removeDelegateChild,
  removeSessionFromAllParents,
  cleanupStoppedDelegateSession,
} from "./coordinator-session-state";
import { findCoordinatorResponseManaged } from "./coordinator-response-routing";
import {
  handleCoordinatorDelegateOperation,
  handleCoordinatorDelegateSyncOperation,
  handleCoordinatorDelegateSendOperation,
  handleCoordinatorDelegateStatusOperation,
  handleCoordinatorDelegateListOperation,
  handleCoordinatorDelegateStopOperation,
  handleCoordinatorDelegateForkOperation,
  type DelegateSendNotFoundReason,
} from "./coordinator-delegate-operations";
import type { DelegateReplyMetadata, DelegateReplyMode } from "./coordinator-delegate-utils";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");
export const DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeAsyncDelegateTimeoutMs(timeoutMs: unknown): number {
  if (typeof timeoutMs !== "number") return DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS;
  return timeoutMs;
}

function formatAsyncDelegateTimeout(timeoutMs: number): string {
  return `Timed out after ${timeoutMs}ms`;
}

/**
 * Minimal managed-client interface needed by CoordinatorHandler.
 * The actual ManagedClient in process-manager.ts satisfies this.
 */
interface CoordinatorManagedClient {
  _activeSessionId: string;
  client: {
    channel(channelName: string): {
      send(payload: unknown): void;
    };
  };
  info: {
    status: string;
    projectPath: string;
    sessionPath: string;
    sessionName?: string;
  };
}

export interface CoordinatorHandlerDeps {
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: Record<string, unknown>,
  ) => Promise<{ status: "started" | "already_running" }>;
  stop: (sessionId: string) => Promise<boolean>;
  send: (sessionId: string, content: string) => unknown;
  steer: (sessionId: string, content: string) => unknown;
  followUp: (sessionId: string, content: string) => unknown;
  broadcastEvent: (method: string, payload: unknown, metadata?: unknown) => Promise<void>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  switchAgent: (sessionId: string, agentName: string) => Promise<unknown>;
  setModel: (sessionId: string, provider: string, modelId: string) => Promise<unknown>;
  setPermissionMode: (sessionId: string, mode: string) => Promise<unknown>;
  getState: (
    sessionId: string,
  ) => Promise<{ isStreaming?: boolean; isCompacting?: boolean } | null>;
  getStatus: (sessionId: string) => { status: "idle" | "streaming" | "stopped"; pid?: number };
  getContextUsage: (
    sessionId: string,
  ) => Promise<{ tokens: number | null; contextWindow: number; percent: number | null }>;
  getActiveManaged: (sessionId: string) => CoordinatorManagedClient | undefined;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  clients: Map<string, CoordinatorManagedClient>;
  processByCwd: Map<string, Set<CoordinatorManagedClient>>;
  isStartInProgress: () => boolean;
  queueDelegateRequest: (args: {
    sessionId: string;
    msg: CoordinatorMethodCall;
    channelName: string;
  }) => Promise<unknown>;
}

export class CoordinatorHandler {
  private deps: CoordinatorHandlerDeps;

  public parentChildMap: DelegateChildMap = new Map<string, Set<string>>();
  public delegateReplyCount = new Map<string, number>();
  public delegateCreatedAt = new Map<string, number>();
  public delegateReplyMode = new Map<string, DelegateReplyMode>();
  public delegateReplyMetadata = new Map<string, DelegateReplyMetadata>();
  public delegateRepliedSessions = new Set<string>();
  public syncDelegateResolvers = new Map<string, SyncDelegateResolver>();
  public subagentSyncChildren = new Set<string>();
  public syncDelegateLastText = new Map<string, string>();
  private delegateTimeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
  private delegateTimeoutMs = new Map<string, number>();
  private delegateTimeoutAt = new Map<string, number>();

  constructor(deps: CoordinatorHandlerDeps) {
    this.deps = deps;
  }

  async handleCoordinatorCall(
    sessionId: string,
    data: unknown,
    channelName: string,
  ): Promise<void> {
    const msg = data as CoordinatorChannelEvent;

    if (!("__call" in msg)) {
      this.deps
        .broadcastEvent("coordinator.event", { sessionId, event: msg }, { sessionId })
        .catch((err: unknown) => {
          log.warn("broadcastEvent(coordinator.event) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }

    const { __call: method, invokeId } = msg;
    let result: unknown;
    try {
      switch (method) {
        case "session_delegate":
          if (this.deps.isStartInProgress()) {
            log.info("[coordinator] session_delegate queued (start in progress)", { sessionId });
            result = await this.deps.queueDelegateRequest({ sessionId, msg, channelName });
          } else {
            result = await this.handleCoordinatorDelegate(sessionId, msg);
          }
          break;
        case "session_delegate_send":
          result = await this.handleCoordinatorDelegateSend(sessionId, msg);
          break;
        case "session_delegate_sync":
          if (this.deps.isStartInProgress()) {
            log.info("[coordinator] session_delegate_sync queued (start in progress)", {
              sessionId,
            });
            result = await this.deps.queueDelegateRequest({ sessionId, msg, channelName });
          } else {
            result = await this.handleCoordinatorDelegateSync(sessionId, msg);
          }
          break;
        case "session_delegate_status":
          result = await this.handleCoordinatorDelegateStatus(sessionId, msg);
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
            result = this.handleCoordinatorClearStopped(sessionId, msg);
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
      const active = this.deps.getActiveManaged(sessionId);
      const route = findCoordinatorResponseManaged({
        active,
        sessionId,
        sessionProjectPaths: this.deps.sessionProjectPaths,
        processByCwd: this.deps.processByCwd,
      });
      const managed = route.managed;
      if (route.matchedViaFallback) {
        log.info("handleCoordinatorCall: routed response via processByCwd fallback", {
          sessionId,
          projectPath: route.projectPath,
          activeSession: managed?._activeSessionId,
        });
      } else if (!managed && route.projectPath) {
        log.warn("handleCoordinatorCall: processByCwd fallback could not find matching process", {
          sessionId,
          projectPath: route.projectPath,
          processCount: route.processCount ?? 0,
        });
      }
      if (managed) {
        managed.client.channel(channelName).send({ ...(result as object), invokeId });
      }
    }
  }

  handleCoordinatorClearStopped(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_clear_stopped" }>,
  ): { cleared: string[]; removed: number } {
    const targetSessionId = (msg as Record<string, unknown>).sessionId as string | undefined;
    const cleared: string[] = [];
    if (targetSessionId) {
      this.clearDelegateTimeout(targetSessionId);
      removeDelegateChild(this.parentChildMap, parentSessionId, targetSessionId);
      clearDelegateTracking(
        this.delegateCreatedAt,
        this.delegateReplyCount,
        targetSessionId,
        undefined,
        this.delegateReplyMetadata,
      );
      this.delegateRepliedSessions.delete(targetSessionId);
      cleared.push(targetSessionId);
      return { cleared, removed: cleared.length };
    }

    const children = [...(this.parentChildMap.get(parentSessionId) ?? [])];
    for (const childSessionId of children) {
      const managed = this.deps.getActiveManaged(childSessionId);
      if (managed?.info.status === "streaming") continue;
      this.clearDelegateTimeout(childSessionId);
      removeDelegateChild(this.parentChildMap, parentSessionId, childSessionId);
      clearDelegateTracking(
        this.delegateCreatedAt,
        this.delegateReplyCount,
        childSessionId,
        undefined,
        this.delegateReplyMetadata,
      );
      this.delegateRepliedSessions.delete(childSessionId);
      cleared.push(childSessionId);
    }
    return { cleared, removed: cleared.length };
  }

  handleCoordinatorRemove(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_remove" }>,
  ): { ok: boolean; removed: boolean } {
    const targetSessionId =
      ((msg as Record<string, unknown>).sessionId as string | undefined) ??
      ((msg as Record<string, unknown>).targetSessionId as string | undefined);
    if (!targetSessionId) return { ok: false, removed: false };
    if (!canManageDelegateChild(this.parentChildMap, parentSessionId, targetSessionId)) {
      return { ok: false, removed: false };
    }

    this.clearDelegateTimeout(targetSessionId);
    removeDelegateChild(this.parentChildMap, parentSessionId, targetSessionId);
    removeSessionFromAllParents(this.parentChildMap, targetSessionId);
    clearDelegateTracking(
      this.delegateCreatedAt,
      this.delegateReplyCount,
      targetSessionId,
      undefined,
      this.delegateReplyMetadata,
    );
    this.delegateRepliedSessions.delete(targetSessionId);
    void this.deps.stop(targetSessionId);
    return { ok: true, removed: true };
  }

  async handleCoordinatorDelegate(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    const result = await handleCoordinatorDelegateOperation({
      parentSessionId,
      msg,
      getActiveManaged: (sid) => this.deps.getActiveManaged(sid) ?? null,
      start: (id, projectPath, sessionPath) =>
        this.deps.start(id, projectPath, sessionPath, { forceNewProcess: true }),
      setPermissionMode: (id, mode) => this.deps.setPermissionMode(id, mode),
      switchAgent: (id, agentName) => this.deps.switchAgent(id, agentName),
      setModel: (id, provider, modelId) => this.deps.setModel(id, provider, modelId),
      stop: (id) => this.deps.stop(id),
      setSessionName: (id, name) => this.deps.setSessionName(id, name),
      send: (id, content) => this.deps.send(id, content),
      broadcastEvent: this.deps.broadcastEvent,
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
      delegateReplyMode: this.delegateReplyMode,
      delegateReplyMetadata: this.delegateReplyMetadata,
    });
    this.scheduleDelegateTimeout(parentSessionId, result.sessionId, msg.timeoutMs);
    return result;
  }

  async handleCoordinatorDelegateSync(
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
      getActiveManaged: (sid) => this.deps.getActiveManaged(sid) ?? null,
      start: (id, projectPath, sessionPath, startOptions) =>
        this.deps.start(id, projectPath, sessionPath, startOptions),
      setPermissionMode: (id, mode) => this.deps.setPermissionMode(id, mode),
      switchAgent: (id, agentName) => this.deps.switchAgent(id, agentName),
      setModel: (id, provider, modelId) => this.deps.setModel(id, provider, modelId),
      setSessionName: (id, name) => this.deps.setSessionName(id, name),
      send: (id, content) => this.deps.send(id, content),
      steer: (id, content) => this.deps.steer(id, content),
      stop: (id) => this.deps.stop(id),
      broadcastEvent: this.deps.broadcastEvent,
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
      delegateReplyMetadata: this.delegateReplyMetadata,
      syncDelegateResolvers: this.syncDelegateResolvers,
      subagentSyncChildren: this.subagentSyncChildren,
      syncDelegateLastText: this.syncDelegateLastText,
    });
  }

  async handleCoordinatorDelegateSend(
    sourceSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
  ): Promise<{
    delivered: boolean;
    targetStatus: "active" | "started" | "not_found";
    notFoundReason?: DelegateSendNotFoundReason;
  }> {
    return handleCoordinatorDelegateSendOperation({
      sourceSessionId,
      msg,
      clients: this.deps.clients,
      sessionPaths: this.deps.sessionPaths,
      sessionProjectPaths: this.deps.sessionProjectPaths,
      delegateReplyCount: this.delegateReplyCount,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyMode: this.delegateReplyMode,
      delegateReplyMetadata: this.delegateReplyMetadata,
      delegateRepliedSessions: this.delegateRepliedSessions,
      parentChildMap: this.parentChildMap,
      start: (id, projectPath, sessionPath) => this.deps.start(id, projectPath, sessionPath),
      send: (id, content) => this.deps.send(id, content),
      steer: (id, content) => this.deps.steer(id, content),
      followUp: (id, content) => this.deps.followUp(id, content),
    });
  }

  async handleCoordinatorDelegateStatus(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>,
  ): Promise<DelegateStatusExt> {
    await this.stopOverdueDelegate(parentSessionId, msg.sessionId);
    return handleCoordinatorDelegateStatusOperation({
      parentSessionId,
      msg,
      parentChildMap: this.parentChildMap,
      sessionPaths: this.deps.sessionPaths,
      sessionProjectPaths: this.deps.sessionProjectPaths,
      getStatus: this.deps.getStatus,
      getState: this.deps.getState,
      getContextUsage: this.deps.getContextUsage,
    });
  }

  handleCoordinatorDelegateList(parentSessionId: string): {
    sessions: Array<{ sessionId: string; status: string; projectPath: string }>;
  } {
    return handleCoordinatorDelegateListOperation({
      parentSessionId,
      parentChildMap: this.parentChildMap,
      clients: this.deps.clients,
    });
  }

  async handleCoordinatorDelegateStop(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>,
  ): Promise<{ ok: boolean }> {
    const result = await handleCoordinatorDelegateStopOperation({
      parentSessionId,
      msg,
      parentChildMap: this.parentChildMap,
      stop: (id) => this.deps.stop(id),
    });
    if (result.ok) this.clearDelegateTimeout(msg.sessionId);
    return result;
  }

  async handleCoordinatorDelegateFork(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    return handleCoordinatorDelegateForkOperation({
      parentSessionId,
      msg,
      clients: this.deps.clients,
      start: (id, projectPath, sessionPath, startOptions) =>
        this.deps.start(id, projectPath, sessionPath, startOptions),
      switchAgent: (id, agentName) => this.deps.switchAgent(id, agentName),
      setModel: (id, provider, modelId) => this.deps.setModel(id, provider, modelId),
      stop: (id) => this.deps.stop(id),
      setSessionName: (id, name) => this.deps.setSessionName(id, name),
      send: (id, content) => this.deps.send(id, content),
      broadcastEvent: this.deps.broadcastEvent,
      parentChildMap: this.parentChildMap,
    });
  }

  /**
   * Clean up all coordinator tracking state for a stopped session.
   * Returns child session IDs that should be cascade-stopped by the caller.
   */
  cleanupStoppedSession(sessionId: string): {
    childSessionIds: string[];
    resolvedSyncDelegate: boolean;
  } {
    this.clearDelegateTimeout(sessionId);
    return cleanupStoppedDelegateSession({
      sessionId,
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
      syncDelegateResolvers: this.syncDelegateResolvers,
      subagentSyncChildren: this.subagentSyncChildren,
      syncDelegateLastText: this.syncDelegateLastText,
    });
  }

  /**
   * Find the parent session ID for a given child session.
   */
  findParentSession(childSessionId: string): string | null {
    for (const [parentId, children] of this.parentChildMap.entries()) {
      if (children.has(childSessionId)) return parentId;
    }
    return null;
  }

  async sendDelegateFallbackReply(childSessionId: string): Promise<boolean> {
    const parentSessionId = this.findParentSession(childSessionId);
    if (!parentSessionId) return false;
    if (!this.delegateCreatedAt.has(childSessionId)) return false;
    if (this.subagentSyncChildren.has(childSessionId)) return false;
    if (this.delegateRepliedSessions.has(childSessionId)) return false;

    const child = this.deps.getActiveManaged(childSessionId);
    const title = child?.info.sessionName ?? childSessionId;
    const message = [
      `委派任务「${title}」已结束，但子会话没有主动回传最终结果。`,
      ``,
      `这是一条系统兜底回执，不代表任务成功或失败。请点击本卡片的跳转入口查看子会话详情。`,
    ].join("\n");

    const result = await this.handleCoordinatorDelegateSend(childSessionId, {
      __call: "session_delegate_send",
      targetSessionId: parentSessionId,
      message,
    });
    return result.delivered;
  }

  private scheduleDelegateTimeout(
    parentSessionId: string,
    childSessionId: string,
    rawTimeoutMs: unknown,
  ): void {
    const timeoutMs = normalizeAsyncDelegateTimeoutMs(rawTimeoutMs);
    this.clearDelegateTimeout(childSessionId);
    this.delegateTimeoutMs.set(childSessionId, timeoutMs);
    this.delegateTimeoutAt.set(childSessionId, Date.now() + timeoutMs);
    const handle = setTimeout(() => {
      void this.stopDelegateForTimeout(parentSessionId, childSessionId);
    }, timeoutMs);
    this.delegateTimeoutHandles.set(childSessionId, handle);
  }

  private clearDelegateTimeout(sessionId: string): void {
    const handle = this.delegateTimeoutHandles.get(sessionId);
    if (handle) clearTimeout(handle);
    this.delegateTimeoutHandles.delete(sessionId);
    this.delegateTimeoutMs.delete(sessionId);
    this.delegateTimeoutAt.delete(sessionId);
  }

  private async stopOverdueDelegate(parentSessionId: string, childSessionId: string): Promise<void> {
    const timeoutAt = this.delegateTimeoutAt.get(childSessionId);
    if (!timeoutAt || Date.now() < timeoutAt) return;
    await this.stopDelegateForTimeout(parentSessionId, childSessionId);
  }

  private async stopDelegateForTimeout(
    parentSessionId: string,
    childSessionId: string,
  ): Promise<void> {
    if (!canManageDelegateChild(this.parentChildMap, parentSessionId, childSessionId)) {
      this.clearDelegateTimeout(childSessionId);
      return;
    }
    const timeoutMs =
      this.delegateTimeoutMs.get(childSessionId) ?? DEFAULT_ASYNC_DELEGATE_TIMEOUT_MS;
    const status = this.deps.getStatus(childSessionId).status;
    const state = await this.deps.getState(childSessionId).catch(() => null);
    if (status !== "streaming" && !state?.isStreaming) {
      this.clearDelegateTimeout(childSessionId);
      return;
    }
    this.clearDelegateTimeout(childSessionId);
    try {
      await this.deps.stop(childSessionId);
    } catch (err: unknown) {
      log.warn("[coordinator] failed to stop timed-out delegate", {
        parentSessionId,
        childSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    this.deps
      .broadcastEvent(
        "coordinator.session_event",
        {
          parentSessionId,
          sessionId: childSessionId,
          event: {
            type: "task_error",
            sessionId: childSessionId,
            error: formatAsyncDelegateTimeout(timeoutMs),
          },
        },
        { parentSessionId, sessionId: childSessionId },
      )
      .catch((err: unknown) => {
        log.warn("[coordinator] failed to broadcast delegate timeout", {
          parentSessionId,
          childSessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }
}
