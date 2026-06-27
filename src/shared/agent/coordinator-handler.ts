import type { CoordinatorMethodCall, CoordinatorChannelEvent } from "../modules/coordinator";
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
import type { DelegateReplyMode } from "./coordinator-delegate-utils";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

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
  public delegateRepliedSessions = new Set<string>();
  public syncDelegateResolvers = new Map<string, SyncDelegateResolver>();
  public subagentSyncChildren = new Set<string>();
  public syncDelegateLastText = new Map<string, string>();

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
      removeDelegateChild(this.parentChildMap, parentSessionId, targetSessionId);
      clearDelegateTracking(this.delegateCreatedAt, this.delegateReplyCount, targetSessionId);
      this.delegateRepliedSessions.delete(targetSessionId);
      cleared.push(targetSessionId);
      return { cleared, removed: cleared.length };
    }

    const children = [...(this.parentChildMap.get(parentSessionId) ?? [])];
    for (const childSessionId of children) {
      const managed = this.deps.getActiveManaged(childSessionId);
      if (managed?.info.status === "streaming") continue;
      removeDelegateChild(this.parentChildMap, parentSessionId, childSessionId);
      clearDelegateTracking(this.delegateCreatedAt, this.delegateReplyCount, childSessionId);
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

    removeDelegateChild(this.parentChildMap, parentSessionId, targetSessionId);
    removeSessionFromAllParents(this.parentChildMap, targetSessionId);
    clearDelegateTracking(this.delegateCreatedAt, this.delegateReplyCount, targetSessionId);
    this.delegateRepliedSessions.delete(targetSessionId);
    void this.deps.stop(targetSessionId);
    return { ok: true, removed: true };
  }

  async handleCoordinatorDelegate(
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
  ): Promise<{ sessionId: string; status: "started" | "already_running" }> {
    return handleCoordinatorDelegateOperation({
      parentSessionId,
      msg,
      getActiveManaged: (sid) => this.deps.getActiveManaged(sid) ?? null,
      start: (id, projectPath, sessionPath) =>
        this.deps.start(id, projectPath, sessionPath, { forceNewProcess: true }),
      setSessionName: (id, name) => this.deps.setSessionName(id, name),
      send: (id, content) => this.deps.send(id, content),
      broadcastEvent: this.deps.broadcastEvent,
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
      delegateReplyMode: this.delegateReplyMode,
    });
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
      switchAgent: (id, agentName) => this.deps.switchAgent(id, agentName),
      setSessionName: (id, name) => this.deps.setSessionName(id, name),
      send: (id, content) => this.deps.send(id, content),
      steer: (id, content) => this.deps.steer(id, content),
      stop: (id) => this.deps.stop(id),
      broadcastEvent: this.deps.broadcastEvent,
      parentChildMap: this.parentChildMap,
      delegateCreatedAt: this.delegateCreatedAt,
      delegateReplyCount: this.delegateReplyCount,
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
  ): Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }> {
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
    return handleCoordinatorDelegateStopOperation({
      parentSessionId,
      msg,
      parentChildMap: this.parentChildMap,
      stop: (id) => this.deps.stop(id),
    });
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
}
