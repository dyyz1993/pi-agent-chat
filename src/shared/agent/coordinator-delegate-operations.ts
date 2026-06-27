import { copyFileSync, existsSync, readFileSync } from "fs";
import * as path from "path";

import type { CoordinatorMethodCall } from "../modules/coordinator";
import { createLogger } from "../lib/logger";
import { getRemoteProjectByPath } from "../lib/project-config";
import {
  canManageDelegateChild,
  canSendDelegateMessage,
  canStopDelegateChild,
  findParentSession,
  listDelegateChildSessions,
  registerDelegateChild,
  removeDelegateChild,
  type DelegateChildMap,
  type DelegateClientInfo,
  type DelegateSessionList,
} from "./coordinator-session-state";
import {
  buildCoordinatorDelegatePrompt,
  buildCoordinatorSessionCreatedEvent,
  buildSyncDelegatePrompt,
  type DelegateReplyMode,
  formatDelegateElapsed,
  resolveDelegateSessionPaths,
  stripParentSessionFromHeader,
  wrapDelegateReply,
  writeDelegateSessionHeader,
} from "./coordinator-delegate-utils";

const log = createLogger("agent");

interface DelegateSendManaged {
  info: {
    status: string;
    sessionPath: string;
    projectPath?: string;
  };
}

interface DelegateSyncParentManaged {
  info: {
    projectPath: string;
    sessionPath: string;
  };
}

interface DelegateParentManaged {
  info: {
    projectPath: string;
    sessionPath: string;
  };
}

export interface DelegateSyncResult {
  sessionId: string;
  status: string;
  exitCode: number;
  finalText: string;
  error?: string;
}

/**
 * Why a delegate send could not be delivered. Used to give the caller an
 * accurate reason instead of the generic "session not found / file may have
 * been deleted" message that is only true for one case.
 */
export type DelegateSendNotFoundReason =
  | "not_a_delegate_child"
  | "session_file_missing";

// ---------------------------------------------------------------------------
// Shared delegate session bootstrap
// ---------------------------------------------------------------------------

interface DelegateParentManagedBase {
  info: {
    projectPath: string;
    sessionPath: string;
  };
}

interface CreateAndStartDelegateSessionOptions<TManaged extends DelegateParentManagedBase> {
  parentSessionId: string;
  rawProjectPath?: string;
  sessionIdPrefix: string;
  delegateType: "coordinator" | "subagent";
  getActiveManaged: (sessionId: string) => TManaged | null;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options: { forceNewProcess: true },
  ) => Promise<unknown>;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  now?: () => number;
  sessionIdFactory?: () => string;
}

interface CreateAndStartDelegateSessionResult {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  parentSessionPath: string;
  createdAt: number;
  startResult: unknown;
}

async function createAndStartDelegateSession<TManaged extends DelegateParentManagedBase>(
  options: CreateAndStartDelegateSessionOptions<TManaged>,
): Promise<CreateAndStartDelegateSessionResult> {
  const parent = options.getActiveManaged(options.parentSessionId);
  if (!parent) throw new Error("Parent session not found");

  const newSessionId =
    options.sessionIdFactory?.() ??
    `${options.sessionIdPrefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const parentProjectPath =
    (await normalizeDelegateProjectPath(parent.info.projectPath)) ?? parent.info.projectPath;
  const rawProjectPath = await normalizeDelegateProjectPath(options.rawProjectPath);
  const { projectPath, sessionPath } = resolveDelegateSessionPaths({
    parentProjectPath,
    parentSessionPath: parent.info.sessionPath,
    newSessionId,
    rawProjectPath,
  });

  try {
    await writeDelegateSessionHeader({
      sessionPath,
      newSessionId,
      projectPath,
      parentSessionId: options.parentSessionId,
      parentSessionPath: parent.info.sessionPath,
      delegateType: options.delegateType,
    });
  } catch (writeErr: unknown) {
    log.warn(`[createDelegateSession] failed to write session header`, {
      sessionPath,
      err: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  const startResult = await options.start(newSessionId, projectPath, sessionPath, {
    forceNewProcess: true,
  });

  const createdAt = (options.now ?? Date.now)();
  options.delegateCreatedAt.set(newSessionId, createdAt);
  options.delegateReplyCount.set(newSessionId, 0);
  registerDelegateChild(options.parentChildMap, options.parentSessionId, newSessionId);

  return {
    sessionId: newSessionId,
    projectPath,
    sessionPath,
    parentSessionPath: parent.info.sessionPath,
    createdAt,
    startResult,
  };
}

async function normalizeDelegateProjectPath(projectPath?: string): Promise<string | undefined> {
  if (!projectPath) return undefined;
  const remoteProject = await getRemoteProjectByPath(projectPath).catch(() => null);
  return remoteProject?.localPath ?? projectPath;
}

// ---------------------------------------------------------------------------
// Delegate operations
// ---------------------------------------------------------------------------

export async function handleCoordinatorDelegateOperation<
  TManaged extends DelegateParentManaged,
>(options: {
  parentSessionId: string;
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate" }>;
  getActiveManaged: (sessionId: string) => TManaged | null;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options: { forceNewProcess: true },
  ) => Promise<{ status: "started" | "already_running" }>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  send: (sessionId: string, content: string) => void;
  broadcastEvent: (
    eventName: string,
    data: unknown,
    filter: Record<string, unknown>,
  ) => Promise<void>;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  delegateReplyMode?: Map<string, DelegateReplyMode>;
  now?: () => number;
  sessionIdFactory?: () => string;
}): Promise<{ sessionId: string; status: "started" | "already_running" }> {
  const { task } = options.msg;
  const replyMode = options.msg.replyMode ?? "interrupt";

  const session = await createAndStartDelegateSession({
    parentSessionId: options.parentSessionId,
    rawProjectPath: options.msg.projectPath,
    sessionIdPrefix: "sess_coord_",
    delegateType: "coordinator",
    getActiveManaged: options.getActiveManaged,
    start: options.start,
    parentChildMap: options.parentChildMap,
    delegateCreatedAt: options.delegateCreatedAt,
    delegateReplyCount: options.delegateReplyCount,
    now: options.now,
    sessionIdFactory: options.sessionIdFactory,
  });
  options.delegateReplyMode?.set(session.sessionId, replyMode);

  const rawTitle = options.msg.title ?? task.slice(0, 60);
  const title = `指派: ${rawTitle}`;
  await options.setSessionName(session.sessionId, title);
  const delegatePrompt = buildCoordinatorDelegatePrompt({
    newSessionId: session.sessionId,
    parentSessionId: options.parentSessionId,
    title,
    task,
    projectPath: session.projectPath,
    replyMode,
  });

  options.send(session.sessionId, delegatePrompt);

  options
    .broadcastEvent(
      "coordinator.session_created",
      buildCoordinatorSessionCreatedEvent({
        parentSessionId: options.parentSessionId,
        sessionId: session.sessionId,
        name: title,
        sessionPath: session.sessionPath,
        projectPath: session.projectPath,
        parentSessionPath: session.parentSessionPath,
        delegateType: "coordinator",
        firstMessage: task,
        createdAt: session.createdAt,
      }),
      { parentSessionId: options.parentSessionId },
    )
    .catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId: options.parentSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    sessionId: session.sessionId,
    status: (session.startResult as { status: "started" | "already_running" }).status,
  };
}

export async function handleCoordinatorDelegateSendOperation<
  TManaged extends DelegateSendManaged,
>(options: {
  sourceSessionId: string;
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>;
  clients: Map<string, TManaged>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  delegateReplyCount: Map<string, number>;
  delegateCreatedAt: Map<string, number>;
  delegateReplyMode?: Map<string, DelegateReplyMode>;
  delegateRepliedSessions?: Set<string>;
  parentChildMap: DelegateChildMap;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ status: "started" | "already_running" }>;
  send: (sessionId: string, content: string) => void;
  steer: (sessionId: string, content: string) => void;
  followUp: (sessionId: string, content: string) => void;
  now?: () => number;
}): Promise<{
  delivered: boolean;
  targetStatus: "active" | "started" | "not_found";
  notFoundReason?: DelegateSendNotFoundReason;
}> {
  const { targetSessionId, message } = options.msg;

  if (
    !canSendDelegateMessage(
      options.parentChildMap,
      options.sourceSessionId,
      targetSessionId,
    )
  ) {
    return {
      delivered: false,
      targetStatus: "not_found",
      // The target is not a delegate child of the source session. The delegate
      // relation either never existed or was cleared (session_delegate_remove
      // or parent-stop cascade cleanup) — the file is not necessarily gone.
      notFoundReason: "not_a_delegate_child",
    };
  }

  let target = options.clients.get(targetSessionId);

  if (!target) {
    const sessionPath = options.sessionPaths.get(targetSessionId) ?? "";
    const projectPath = options.sessionProjectPaths.get(targetSessionId) ?? "";
    if (sessionPath && projectPath && existsSync(sessionPath)) {
      try {
        const result = await options.start(targetSessionId, projectPath, sessionPath);
        target = options.clients.get(targetSessionId);
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
      // Target passed the delegate-child check but is not running and could not
      // be restarted. If its session file is gone this is a real deletion;
      // otherwise it is an unknown runtime state (not a file-deletion case).
      const sessionPath = options.sessionPaths.get(targetSessionId) ?? "";
      return {
        delivered: false,
        targetStatus: "not_found",
        notFoundReason:
          sessionPath && !existsSync(sessionPath)
            ? "session_file_missing"
            : "not_a_delegate_child",
      };
    }
  }

  const count = (options.delegateReplyCount.get(targetSessionId) ?? 0) + 1;
  options.delegateReplyCount.set(targetSessionId, count);

  const now = options.now ?? Date.now;
  const createdAt = options.delegateCreatedAt.get(targetSessionId) ?? now();
  const elapsed = formatDelegateElapsed(createdAt, now());

  const parentSessionId = findParentSession(options.parentChildMap, targetSessionId);
  let title = "";
  if (parentSessionId && options.clients.get(parentSessionId)) {
    title = target.info.sessionPath.split("/").pop()?.replace(".jsonl", "") ?? "";
  }

  const wrappedMessage = wrapDelegateReply({
    sourceSessionId: options.sourceSessionId,
    targetSessionId,
    title,
    sequence: count,
    createdAt,
    elapsed,
    message,
  });

  const configuredMode = options.delegateReplyMode?.get(options.sourceSessionId) ?? "interrupt";
  const deliveryMode =
    options.msg.mode ??
    (configuredMode === "interrupt"
      ? "steer"
      : configuredMode === "followUp"
        ? "followUp"
        : undefined);

  if (deliveryMode === "steer") {
    options.steer(targetSessionId, wrappedMessage);
  } else if (deliveryMode === "followUp" || target.info.status === "streaming") {
    options.followUp(targetSessionId, wrappedMessage);
  } else {
    options.send(targetSessionId, wrappedMessage);
  }
  options.delegateRepliedSessions?.add(options.sourceSessionId);

  return { delivered: true, targetStatus: "active" };
}

export async function handleCoordinatorDelegateSyncOperation<
  TManaged extends DelegateSyncParentManaged,
>(options: {
  parentSessionId: string;
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>;
  getActiveManaged: (sessionId: string) => TManaged | null;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options: { forceNewProcess: true },
  ) => Promise<unknown>;
  switchAgent: (sessionId: string, agentName: string) => Promise<unknown>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  send: (sessionId: string, content: string) => void;
  steer: (sessionId: string, content: string) => void;
  stop: (sessionId: string) => Promise<boolean>;
  broadcastEvent: (
    eventName: string,
    data: unknown,
    filter: Record<string, unknown>,
  ) => Promise<void>;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  syncDelegateResolvers: Map<
    string,
    {
      resolve: (result: DelegateSyncResult) => void;
      timeout: ReturnType<typeof setTimeout>;
      parentSessionId: string;
    }
  >;
  subagentSyncChildren: Set<string>;
  syncDelegateLastText: Map<string, string>;
  now?: () => number;
  sessionIdFactory?: () => string;
}): Promise<DelegateSyncResult> {
  const { task, title, agent, timeoutMs = 1800000 } = options.msg;

  const session = await createAndStartDelegateSession({
    parentSessionId: options.parentSessionId,
    rawProjectPath: options.msg.projectPath,
    sessionIdPrefix: "sess_sub_",
    delegateType: "subagent",
    getActiveManaged: options.getActiveManaged,
    start: options.start,
    parentChildMap: options.parentChildMap,
    delegateCreatedAt: options.delegateCreatedAt,
    delegateReplyCount: options.delegateReplyCount,
    now: options.now,
    sessionIdFactory: options.sessionIdFactory,
  });

  if (agent) {
    try {
      await options.switchAgent(session.sessionId, agent);
      log.info("[handleCoordinatorDelegateSync] agent switched", {
        newSessionId: session.sessionId,
        agent,
      });
    } catch (switchErr: unknown) {
      log.warn("[handleCoordinatorDelegateSync] switchAgent failed, using default agent", {
        newSessionId: session.sessionId,
        agent,
        err: switchErr instanceof Error ? switchErr.message : String(switchErr),
      });
    }
  }

  const rawTitle = title ?? task.slice(0, 60);
  await options.setSessionName(session.sessionId, `子代理: ${rawTitle}`);
  const delegatePrompt = buildSyncDelegatePrompt({
    task,
    rawTitle,
    agent,
    projectPath: session.projectPath,
  });

  options.subagentSyncChildren.add(session.sessionId);
  const syncPromise = new Promise<DelegateSyncResult>((resolve) => {
    const preTimeoutMs = Math.max(timeoutMs - 60_000, 30_000);
    const preTimeout = setTimeout(() => {
      if (!options.syncDelegateResolvers.has(session.sessionId)) return;
      log.info("[syncDelegate] pre-timeout summarize injection", {
        sessionId: session.sessionId,
      });
      options.steer(
        session.sessionId,
        `[系统指令] 任务已运行较长时间（${Math.round((timeoutMs - 60_000) / 60_000)} 分钟），请在 60 秒内汇报阶段性成果：已完成的工作、未完成的部分、以及下一步该怎么做，以便主任务可以恢复继续。`,
      );
    }, preTimeoutMs);

    const timeout = setTimeout(() => {
      clearTimeout(preTimeout);
      log.warn("[syncDelegate] timed out", {
        sessionId: session.sessionId,
        parentSessionId: options.parentSessionId,
        timeoutMs,
      });
      const lastText = options.syncDelegateLastText.get(session.sessionId) ?? "";
      options.syncDelegateResolvers.delete(session.sessionId);
      options.subagentSyncChildren.delete(session.sessionId);
      options.syncDelegateLastText.delete(session.sessionId);
      resolve({
        sessionId: session.sessionId,
        status: "timeout",
        exitCode: 1,
        finalText: lastText || "(timed out, no output captured)",
      });
    }, timeoutMs);

    options.syncDelegateResolvers.set(session.sessionId, {
      resolve,
      timeout,
      parentSessionId: options.parentSessionId,
    });
  });

  options.send(session.sessionId, delegatePrompt);
  options
    .broadcastEvent(
      "coordinator.session_created",
      buildCoordinatorSessionCreatedEvent({
        parentSessionId: options.parentSessionId,
        sessionId: session.sessionId,
        name: rawTitle,
        sessionPath: session.sessionPath,
        projectPath: session.projectPath,
        parentSessionPath: session.parentSessionPath,
        delegateType: "subagent",
        firstMessage: task,
        createdAt: session.createdAt,
      }),
      { parentSessionId: options.parentSessionId },
    )
    .catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId: options.parentSessionId,
        newSessionId: session.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  options
    .broadcastEvent(
      "subagent.event",
      {
        parentSessionId: options.parentSessionId,
        parentSessionPath: session.parentSessionPath,
        subSessionId: session.sessionId,
        event: {
          type: "subagent_start",
          toolCallId: "",
          description: rawTitle,
          instruction: task,
        },
      },
      { parentSessionId: options.parentSessionId },
    )
    .catch((err: unknown) => {
      log.warn("broadcastEvent(subagent_start) error", {
        parentSessionId: options.parentSessionId,
        newSessionId: session.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  const syncResult = await syncPromise;

  await options.stop(session.sessionId);
  removeDelegateChild(options.parentChildMap, options.parentSessionId, session.sessionId);

  return syncResult;
}

export async function handleCoordinatorDelegateForkOperation<
  TClient extends DelegateParentManaged,
>(options: {
  parentSessionId: string;
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_fork" }>;
  clients: Map<string, TClient>;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options: { forceNewProcess: true },
  ) => Promise<{ status: "started" | "already_running" }>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  send: (sessionId: string, content: string) => void;
  broadcastEvent: (
    eventName: string,
    data: unknown,
    filter: Record<string, unknown>,
  ) => Promise<void>;
  parentChildMap: DelegateChildMap;
  sessionIdFactory?: () => string;
}): Promise<{ sessionId: string; status: "started" | "already_running" }> {
  const { task, sessionId: targetSessionId } = options.msg;
  if (
    !canManageDelegateChild(
      options.parentChildMap,
      options.parentSessionId,
      targetSessionId,
    )
  ) {
    throw new Error(`Session not found: ${targetSessionId}`);
  }
  const base = options.clients.get(targetSessionId);
  if (!base) throw new Error(`Session not found: ${targetSessionId}`);

  const sessionPath = base.info.sessionPath;
  const projectPath = base.info.projectPath;
  const sessionDir = path.dirname(sessionPath);
  const forkedSessionId =
    options.sessionIdFactory?.() ??
    `sess_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const forkedPath = path.join(sessionDir, `${forkedSessionId}.jsonl`);

  if (existsSync(sessionPath)) {
    copyFileSync(sessionPath, forkedPath);
  }

  stripParentSessionFromHeader(forkedPath);

  const result = await options.start(forkedSessionId, projectPath, forkedPath, {
    forceNewProcess: true,
  });

  registerDelegateChild(options.parentChildMap, options.parentSessionId, forkedSessionId);

  const title = options.msg.title ?? task.slice(0, 60);
  await options.setSessionName(forkedSessionId, title);
  options.send(forkedSessionId, task);

  options
    .broadcastEvent(
      "coordinator.session_created",
      buildCoordinatorSessionCreatedEvent({
        parentSessionId: options.parentSessionId,
        sessionId: forkedSessionId,
        name: title,
        sessionPath: forkedPath,
        projectPath,
        parentSessionPath: sessionPath,
        delegateType: "fork",
        firstMessage: task,
      }),
      { parentSessionId: options.parentSessionId },
    )
    .catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created from fork) error", {
        sessionId: forkedSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  return { sessionId: forkedSessionId, status: result.status };
}

export async function handleCoordinatorDelegateStatusOperation(options: {
  parentSessionId: string;
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>;
  parentChildMap: DelegateChildMap;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  getStatus: (sessionId: string) => { status: "idle" | "streaming" | "stopped"; pid?: number };
  getState: (
    sessionId: string,
  ) => Promise<{ isStreaming?: boolean; isCompacting?: boolean } | null>;
  getContextUsage: (
    sessionId: string,
  ) => Promise<{ tokens: number | null; contextWindow: number; percent: number | null }>;
}): Promise<{ status: string; isCompacting: boolean; contextUsage: unknown }> {
  const { sessionId: targetSessionId } = options.msg;
  const parentChildren = options.parentChildMap.get(options.parentSessionId);
  if (!parentChildren?.has(targetSessionId)) {
    return {
      status: "not_found",
      isCompacting: false,
      contextUsage: { tokens: null, contextWindow: 0, percent: null },
    };
  }

  const status = options.getStatus(targetSessionId);
  if (status.status === "stopped") {
    const hasRecord =
      options.sessionPaths.has(targetSessionId) || options.sessionProjectPaths.has(targetSessionId);
    return {
      status: hasRecord ? "stopped" : "not_found",
      isCompacting: false,
      contextUsage: { tokens: null, contextWindow: 0, percent: null },
    };
  }

  const state = await options.getState(targetSessionId);
  const contextUsage = await options.getContextUsage(targetSessionId);

  return {
    status: state?.isStreaming
      ? "streaming"
      : hasAssistantMessage(options.sessionPaths.get(targetSessionId))
        ? "completed"
        : "idle",
    isCompacting: state?.isCompacting ?? false,
    contextUsage,
  };
}

function hasAssistantMessage(sessionPath: string | undefined): boolean {
  if (!sessionPath || !existsSync(sessionPath)) return false;
  try {
    const lines = readFileSync(sessionPath, "utf-8").split("\n");
    return lines.some((line) => {
      if (!line.trim()) return false;
      try {
        const entry = JSON.parse(line) as unknown;
        if (!entry || typeof entry !== "object") return false;
        const record = entry as Record<string, unknown>;
        if (record.type !== "message") return false;
        const message = record.message;
        return (
          typeof message === "object" &&
          message !== null &&
          (message as Record<string, unknown>).role === "assistant"
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function handleCoordinatorDelegateListOperation<
  TClient extends DelegateClientInfo,
>(options: {
  parentSessionId: string;
  parentChildMap: DelegateChildMap;
  clients: Map<string, TClient>;
}): DelegateSessionList {
  return listDelegateChildSessions(
    options.parentChildMap,
    options.clients,
    options.parentSessionId,
  );
}

export async function handleCoordinatorDelegateStopOperation(options: {
  parentSessionId: string;
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_stop" }>;
  parentChildMap: DelegateChildMap;
  stop: (sessionId: string) => Promise<boolean>;
}): Promise<{ ok: boolean }> {
  const { sessionId: targetSessionId } = options.msg;
  if (!canStopDelegateChild(options.parentChildMap, options.parentSessionId, targetSessionId)) {
    return { ok: false };
  }
  const ok = await options.stop(targetSessionId);
  if (ok) {
    registerDelegateChild(options.parentChildMap, options.parentSessionId, targetSessionId);
  }
  return { ok };
}
