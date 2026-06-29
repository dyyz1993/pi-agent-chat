import type { CoordinatorMethodCall } from "../modules/coordinator";
import {
  clearDelegateTracking,
  canManageDelegateChild,
  removeDelegateChild,
  removeSessionFromAllParents,
  type DelegateChildMap,
  type SyncDelegateResolver,
} from "./coordinator-session-state";
import {
  handleCoordinatorDelegateOperation,
  handleCoordinatorDelegateForkOperation,
  handleCoordinatorDelegateListOperation,
  handleCoordinatorDelegateSendOperation,
  handleCoordinatorDelegateSyncOperation,
  handleCoordinatorDelegateStatusOperation,
  handleCoordinatorDelegateStopOperation,
  type DelegateSendNotFoundReason,
  type DelegateSyncResult,
} from "./coordinator-delegate-operations";
import type { DelegateReplyMode } from "./coordinator-delegate-utils";

interface CoordinatorManagedClient {
  info: {
    status: string;
    projectPath: string;
    sessionPath: string;
  };
}

export interface CoordinatorHandlerAdapter {
  handleClearStopped: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_clear_stopped" }>,
  ) => { cleared: string[]; removed: number };
  handleRemove: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_remove" }>,
  ) => { ok: boolean; removed: boolean };
  handleDelegate: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
  ) => Promise<{ sessionId: string; status: "started" | "already_running" }>;
  handleDelegateSync: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
  ) => Promise<DelegateSyncResult>;
  handleDelegateSend: (
    sourceSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
  ) => Promise<{
    delivered: boolean;
    targetStatus: "active" | "started" | "not_found";
    notFoundReason?: DelegateSendNotFoundReason;
  }>;
  handleDelegateStatus: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>,
  ) => Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }>;
  handleDelegateList: (parentSessionId: string) => {
    sessions: Array<{ sessionId: string; status: string; projectPath: string }>;
  };
  handleDelegateStop: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>,
  ) => Promise<{ ok: boolean }>;
  handleDelegateFork: (
    parentSessionId: string,
    msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>,
  ) => Promise<{ sessionId: string; status: "started" | "already_running" }>;
}

export function createCoordinatorHandlerAdapter<TManaged extends CoordinatorManagedClient>(deps: {
  clients: Map<string, TManaged>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  delegateReplyMode: Map<string, DelegateReplyMode>;
  delegateRepliedSessions: Set<string>;
  syncDelegateResolvers: Map<string, SyncDelegateResolver>;
  subagentSyncChildren: Set<string>;
  syncDelegateLastText: Map<string, string>;
  getActiveManaged: (sessionId: string) => TManaged | null;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: { forceNewProcess?: boolean; userId?: string },
  ) => Promise<{ status: "started" | "already_running" }>;
  switchAgent: (sessionId: string, agentName: string) => Promise<unknown>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  send: (sessionId: string, content: string) => void;
  steer: (sessionId: string, content: string) => void;
  followUp: (sessionId: string, content: string) => void;
  stop: (sessionId: string) => Promise<boolean>;
  getStatus: (sessionId: string) => { status: "idle" | "streaming" | "stopped"; pid?: number };
  getState: (
    sessionId: string,
  ) => Promise<{ isStreaming?: boolean; isCompacting?: boolean } | null>;
  getContextUsage: (
    sessionId: string,
  ) => Promise<{ tokens: number | null; contextWindow: number; percent: number | null }>;
  broadcastEvent: (
    eventName: string,
    data: unknown,
    filter: Record<string, unknown>,
  ) => Promise<void>;
}): CoordinatorHandlerAdapter {
  return {
    handleClearStopped(parentSessionId, msg) {
      const targetSessionId = (msg as Record<string, unknown>).sessionId as string | undefined;
      const cleared: string[] = [];
      if (targetSessionId) {
        removeDelegateChild(deps.parentChildMap, parentSessionId, targetSessionId);
        clearDelegateTracking(deps.delegateCreatedAt, deps.delegateReplyCount, targetSessionId);
        deps.delegateRepliedSessions.delete(targetSessionId);
        cleared.push(targetSessionId);
        return { cleared, removed: cleared.length };
      }

      const children = [...(deps.parentChildMap.get(parentSessionId) ?? [])];
      for (const childSessionId of children) {
        const managed = deps.clients.get(childSessionId);
        if (managed?.info.status === "streaming") continue;
        removeDelegateChild(deps.parentChildMap, parentSessionId, childSessionId);
        clearDelegateTracking(deps.delegateCreatedAt, deps.delegateReplyCount, childSessionId);
        deps.delegateRepliedSessions.delete(childSessionId);
        cleared.push(childSessionId);
      }
      return { cleared, removed: cleared.length };
    },
    handleRemove(parentSessionId, msg) {
      const targetSessionId =
        ((msg as Record<string, unknown>).sessionId as string | undefined) ??
        ((msg as Record<string, unknown>).targetSessionId as string | undefined);
      if (!targetSessionId) return { ok: false, removed: false };
      if (!canManageDelegateChild(deps.parentChildMap, parentSessionId, targetSessionId)) {
        return { ok: false, removed: false };
      }
      removeDelegateChild(deps.parentChildMap, parentSessionId, targetSessionId);
      removeSessionFromAllParents(deps.parentChildMap, targetSessionId);
      clearDelegateTracking(deps.delegateCreatedAt, deps.delegateReplyCount, targetSessionId);
      deps.delegateRepliedSessions.delete(targetSessionId);
      void deps.stop(targetSessionId);
      return { ok: true, removed: true };
    },
    handleDelegate(parentSessionId, msg) {
      return handleCoordinatorDelegateOperation({
        parentSessionId,
        msg,
        getActiveManaged: deps.getActiveManaged,
        start: (id, projectPath, sessionPath) =>
          deps.start(id, projectPath, sessionPath, { forceNewProcess: true }),
        setSessionName: deps.setSessionName,
        send: deps.send,
        broadcastEvent: deps.broadcastEvent,
        parentChildMap: deps.parentChildMap,
        delegateCreatedAt: deps.delegateCreatedAt,
        delegateReplyCount: deps.delegateReplyCount,
        delegateReplyMode: deps.delegateReplyMode,
      });
    },
    handleDelegateSync(parentSessionId, msg) {
      return handleCoordinatorDelegateSyncOperation({
        parentSessionId,
        msg,
        getActiveManaged: deps.getActiveManaged,
        start: (id, projectPath, sessionPath, startOptions) =>
          deps.start(id, projectPath, sessionPath, startOptions),
        switchAgent: deps.switchAgent,
        setSessionName: deps.setSessionName,
        send: deps.send,
        steer: deps.steer,
        stop: deps.stop,
        broadcastEvent: deps.broadcastEvent,
        parentChildMap: deps.parentChildMap,
        delegateCreatedAt: deps.delegateCreatedAt,
        delegateReplyCount: deps.delegateReplyCount,
        syncDelegateResolvers: deps.syncDelegateResolvers,
        subagentSyncChildren: deps.subagentSyncChildren,
        syncDelegateLastText: deps.syncDelegateLastText,
      });
    },
    handleDelegateSend(sourceSessionId, msg) {
      return handleCoordinatorDelegateSendOperation({
        sourceSessionId,
        msg,
        clients: deps.clients,
        sessionPaths: deps.sessionPaths,
        sessionProjectPaths: deps.sessionProjectPaths,
        delegateReplyCount: deps.delegateReplyCount,
        delegateCreatedAt: deps.delegateCreatedAt,
        delegateReplyMode: deps.delegateReplyMode,
        delegateRepliedSessions: deps.delegateRepliedSessions,
        parentChildMap: deps.parentChildMap,
        start: (sessionId, projectPath, sessionPath) =>
          deps.start(sessionId, projectPath, sessionPath),
        send: deps.send,
        steer: deps.steer,
        followUp: deps.followUp,
      });
    },
    handleDelegateStatus(parentSessionId, msg) {
      return handleCoordinatorDelegateStatusOperation({
        parentSessionId,
        msg,
        parentChildMap: deps.parentChildMap,
        sessionPaths: deps.sessionPaths,
        sessionProjectPaths: deps.sessionProjectPaths,
        getStatus: deps.getStatus,
        getState: deps.getState,
        getContextUsage: deps.getContextUsage,
      });
    },
    handleDelegateList(parentSessionId) {
      return handleCoordinatorDelegateListOperation({
        parentSessionId,
        parentChildMap: deps.parentChildMap,
        clients: deps.clients,
      });
    },
    handleDelegateStop(parentSessionId, msg) {
      return handleCoordinatorDelegateStopOperation({
        parentSessionId,
        msg,
        parentChildMap: deps.parentChildMap,
        stop: deps.stop,
      });
    },
    handleDelegateFork(parentSessionId, msg) {
      return handleCoordinatorDelegateForkOperation({
        parentSessionId,
        msg,
        clients: deps.clients,
        start: (id, projectPath, sessionPath, startOptions) =>
          deps.start(id, projectPath, sessionPath, startOptions),
        setSessionName: deps.setSessionName,
        send: deps.send,
        broadcastEvent: deps.broadcastEvent,
        parentChildMap: deps.parentChildMap,
      });
    },
  };
}
