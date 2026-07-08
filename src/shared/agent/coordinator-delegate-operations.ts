import { copyFileSync, existsSync, readFileSync } from "fs";
import * as path from "path";

import type {
  CoordinatorMethodCall,
  DelegateStatusDetail,
  DelegateStatusExt,
  DelegateStatusWaitingType,
} from "../modules/coordinator";
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
  buildDelegateReplyParams,
  buildCoordinatorDelegatePrompt,
  buildCoordinatorSessionCreatedEvent,
  buildSyncDelegatePrompt,
  type DelegateReplyMode,
  type DelegateReplyMetadata,
  formatDelegateElapsed,
  resolveDelegateSessionPaths,
  stripParentSessionFromHeader,
  wrapDelegateReply,
  writeDelegateSessionHeader,
} from "./coordinator-delegate-utils";

const log = createLogger("agent");
const ASYNC_DELEGATE_REQUIRED_TOOLS = ["session_delegate_send"] as const;

interface DelegateSendManaged {
  info: {
    status: string;
    sessionPath: string;
    projectPath?: string;
  };
}

function resolveDelegateMetadataSessionId(
  parentChildMap: DelegateChildMap,
  sourceSessionId: string,
  targetSessionId: string,
): string {
  if (parentChildMap.get(sourceSessionId)?.has(targetSessionId)) return targetSessionId;
  if (findParentSession(parentChildMap, sourceSessionId) === targetSessionId) {
    return sourceSessionId;
  }
  return targetSessionId;
}

function hasKnownDelegateSendTarget<TManaged extends DelegateSendManaged>(
  clients: Map<string, TManaged>,
  sessionPaths: Map<string, string>,
  targetSessionId: string,
): boolean {
  if (clients.has(targetSessionId)) return true;
  const sessionPath = sessionPaths.get(targetSessionId) ?? "";
  return Boolean(sessionPath && existsSync(sessionPath));
}

interface DelegateSyncParentManaged {
  info: {
    projectPath: string;
    sessionPath: string;
    permissionMode?: string;
  };
}

interface DelegateParentManaged {
  info: {
    projectPath: string;
    sessionPath: string;
    permissionMode?: string;
  };
}

function formatDelegateTimeoutDuration(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return `${timeoutMs}ms`;
  if (timeoutMs % 60_000 === 0) return `${timeoutMs / 60_000} 分钟`;
  if (timeoutMs % 1000 === 0) return `${timeoutMs / 1000} 秒`;
  return `${timeoutMs}ms`;
}

export function buildDelegateSyncTimeoutRecoveryText(options: {
  sessionId: string;
  timeoutMs: number;
  lastText?: string;
}): string {
  const lastText = options.lastText?.trim();
  return [
    `子任务等待超时（${formatDelegateTimeoutDuration(options.timeoutMs)}），但子会话没有被终止，可以恢复继续。`,
    "",
    `- 子会话 ID: \`${options.sessionId}\``,
    `- 查看状态: \`session_delegate_status({"sessionId":"${options.sessionId}"})\``,
    `- 如需停止: \`session_delegate_stop({"sessionId":"${options.sessionId}"})\``,
    `- 如需继续: 打开子会话 \`${options.sessionId}\`，发送后续指令；完成后回到主会话查看结果。`,
    "",
    "最近输出:",
    lastText || "暂无可用输出。",
  ].join("\n");
}

export type CoordinatorSetModelFromName = (
  sessionId: string,
  model: string,
  options: {
    parentSessionId: string;
    projectPath?: string;
  },
) => Promise<unknown>;

async function cleanupFailedDelegateBootstrap(options: {
  sessionId: string;
  parentSessionId: string;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt?: Map<string, number>;
  delegateReplyCount?: Map<string, number>;
  delegateReplyMode?: Map<string, DelegateReplyMode>;
  delegateReplyMetadata?: Map<string, DelegateReplyMetadata>;
  stop?: (sessionId: string) => Promise<unknown>;
}): Promise<void> {
  removeDelegateChild(options.parentChildMap, options.parentSessionId, options.sessionId);
  options.delegateCreatedAt?.delete(options.sessionId);
  options.delegateReplyCount?.delete(options.sessionId);
  options.delegateReplyMode?.delete(options.sessionId);
  options.delegateReplyMetadata?.delete(options.sessionId);

  if (!options.stop) return;
  try {
    await options.stop(options.sessionId);
  } catch (stopErr: unknown) {
    log.warn("[createDelegateSession] failed to stop delegate after setup failure", {
      sessionId: options.sessionId,
      err: stopErr instanceof Error ? stopErr.message : String(stopErr),
    });
  }
}

function buildRequiredAgentSwitchError(options: {
  sessionId: string;
  agent: string;
  err: unknown;
}): Error {
  const reason = options.err instanceof Error ? options.err.message : String(options.err);
  return new Error(
    `Failed to switch delegated session ${options.sessionId} to agent "${options.agent}": ${reason}`,
  );
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
export type DelegateSendNotFoundReason = "not_a_delegate_child" | "session_file_missing";

// ---------------------------------------------------------------------------
// Shared delegate session bootstrap
// ---------------------------------------------------------------------------

interface DelegateParentManagedBase {
  info: {
    projectPath: string;
    sessionPath: string;
    permissionMode?: string;
  };
}

interface CreateAndStartDelegateSessionOptions<TManaged extends DelegateParentManagedBase> {
  parentSessionId: string;
  rawProjectPath?: string;
  sessionIdPrefix: string;
  delegateType: "coordinator" | "subagent";
  agent?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options: { forceNewProcess: true; delegateParentSessionId: string },
  ) => Promise<unknown>;
  setPermissionMode?: (sessionId: string, mode: string) => Promise<unknown>;
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
      permissionMode: parent.info.permissionMode,
      agent: options.agent,
    });
  } catch (writeErr: unknown) {
    log.warn(`[createDelegateSession] failed to write session header`, {
      sessionPath,
      err: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  const startResult = await options.start(newSessionId, projectPath, sessionPath, {
    forceNewProcess: true,
    delegateParentSessionId: options.parentSessionId,
  });
  await inheritDelegatePermissionMode({
    sessionId: newSessionId,
    permissionMode: parent.info.permissionMode,
    setPermissionMode: options.setPermissionMode,
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

async function inheritDelegatePermissionMode(options: {
  sessionId: string;
  permissionMode?: string;
  setPermissionMode?: (sessionId: string, mode: string) => Promise<unknown>;
}): Promise<void> {
  const permissionMode = options.permissionMode?.trim();
  if (!permissionMode || !options.setPermissionMode) return;
  try {
    await options.setPermissionMode(options.sessionId, permissionMode);
  } catch (err: unknown) {
    log.warn("[createDelegateSession] failed to inherit permission mode", {
      sessionId: options.sessionId,
      permissionMode,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function extractActiveToolNames(switchResult: unknown): string[] | null {
  if (!switchResult || typeof switchResult !== "object") return null;
  const tools = (switchResult as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return null;
  return tools.filter((tool): tool is string => typeof tool === "string");
}

async function ensureAsyncDelegateReplyTools(options: {
  sessionId: string;
  switchResult: unknown;
  setActiveTools?: (sessionId: string, toolNames: string[]) => Promise<unknown>;
}): Promise<void> {
  const activeTools = extractActiveToolNames(options.switchResult);
  if (!activeTools) return;

  const missingTools = ASYNC_DELEGATE_REQUIRED_TOOLS.filter((tool) => !activeTools.includes(tool));
  if (missingTools.length === 0) return;

  if (!options.setActiveTools) {
    log.warn("[handleCoordinatorDelegate] missing setActiveTools for delegate reply tools", {
      sessionId: options.sessionId,
      missingTools,
    });
    return;
  }

  const restoredTools = [...activeTools, ...missingTools];
  await options.setActiveTools(options.sessionId, restoredTools);
  log.info("[handleCoordinatorDelegate] restored delegate reply tools", {
    sessionId: options.sessionId,
    missingTools,
  });
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
    options: { forceNewProcess: true; delegateParentSessionId: string },
  ) => Promise<{ status: "started" | "already_running" }>;
  setPermissionMode?: (sessionId: string, mode: string) => Promise<unknown>;
  switchAgent?: (sessionId: string, agentName: string) => Promise<unknown>;
  setActiveTools?: (sessionId: string, toolNames: string[]) => Promise<unknown>;
  setModelFromName?: CoordinatorSetModelFromName;
  stop?: (sessionId: string) => Promise<unknown>;
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
  delegateReplyMetadata?: Map<string, DelegateReplyMetadata>;
  now?: () => number;
  sessionIdFactory?: () => string;
}): Promise<{ sessionId: string; status: "started" | "already_running" }> {
  const { task } = options.msg;
  const agent = options.msg.agent ?? options.msg.agentName;
  const replyMode = options.msg.replyMode ?? "interrupt";

  const session = await createAndStartDelegateSession({
    parentSessionId: options.parentSessionId,
    rawProjectPath: options.msg.projectPath,
    sessionIdPrefix: "sess_coord_",
    delegateType: "coordinator",
    getActiveManaged: options.getActiveManaged,
    start: options.start,
    setPermissionMode: options.setPermissionMode,
    agent,
    parentChildMap: options.parentChildMap,
    delegateCreatedAt: options.delegateCreatedAt,
    delegateReplyCount: options.delegateReplyCount,
    now: options.now,
    sessionIdFactory: options.sessionIdFactory,
  });
  options.delegateReplyMode?.set(session.sessionId, replyMode);
  if (options.msg.model && options.setModelFromName) {
    try {
      await options.setModelFromName(session.sessionId, options.msg.model, {
        parentSessionId: options.parentSessionId,
        projectPath: session.projectPath,
      });
      log.info("[handleCoordinatorDelegate] model switched", {
        newSessionId: session.sessionId,
        model: options.msg.model,
      });
    } catch (modelErr: unknown) {
      log.warn("[handleCoordinatorDelegate] setModel failed, using default model", {
        newSessionId: session.sessionId,
        model: options.msg.model,
        err: modelErr instanceof Error ? modelErr.message : String(modelErr),
      });
    }
  }

  if (agent && options.switchAgent) {
    try {
      const switchResult = await options.switchAgent(session.sessionId, agent);
      await ensureAsyncDelegateReplyTools({
        sessionId: session.sessionId,
        switchResult,
        setActiveTools: options.setActiveTools,
      });
      log.info("[handleCoordinatorDelegate] agent switched", {
        newSessionId: session.sessionId,
        agent,
      });
    } catch (switchErr: unknown) {
      log.warn("[handleCoordinatorDelegate] switchAgent failed, aborting delegate", {
        newSessionId: session.sessionId,
        agent,
        err: switchErr instanceof Error ? switchErr.message : String(switchErr),
      });
      await cleanupFailedDelegateBootstrap({
        sessionId: session.sessionId,
        parentSessionId: options.parentSessionId,
        parentChildMap: options.parentChildMap,
        delegateCreatedAt: options.delegateCreatedAt,
        delegateReplyCount: options.delegateReplyCount,
        delegateReplyMode: options.delegateReplyMode,
        delegateReplyMetadata: options.delegateReplyMetadata,
        stop: options.stop,
      });
      throw buildRequiredAgentSwitchError({
        sessionId: session.sessionId,
        agent,
        err: switchErr,
      });
    }
  }

  const rawTitle = options.msg.title ?? task.slice(0, 60);
  const title = `指派: ${rawTitle}`;
  options.delegateReplyMetadata?.set(session.sessionId, {
    task,
    title,
    projectPath: session.projectPath,
    replyMode,
    agent,
    params: buildDelegateReplyParams({
      title,
      agent,
      projectPath: session.projectPath,
      replyMode,
    }),
  });
  await options.setSessionName(session.sessionId, title);
  const delegatePrompt = buildCoordinatorDelegatePrompt({
    newSessionId: session.sessionId,
    parentSessionId: options.parentSessionId,
    title,
    task,
    projectPath: session.projectPath,
    agent,
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
        agent,
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
  delegateReplyMetadata?: Map<string, DelegateReplyMetadata>;
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
    !canSendDelegateMessage(options.parentChildMap, options.sourceSessionId, targetSessionId) &&
    !hasKnownDelegateSendTarget(options.clients, options.sessionPaths, targetSessionId)
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
          sessionPath && !existsSync(sessionPath) ? "session_file_missing" : "not_a_delegate_child",
      };
    }
  }

  const metadataSessionId = resolveDelegateMetadataSessionId(
    options.parentChildMap,
    options.sourceSessionId,
    targetSessionId,
  );

  const count = (options.delegateReplyCount.get(metadataSessionId) ?? 0) + 1;
  options.delegateReplyCount.set(metadataSessionId, count);

  const now = options.now ?? Date.now;
  const createdAt = options.delegateCreatedAt.get(metadataSessionId) ?? now();
  const elapsed = formatDelegateElapsed(createdAt, now());
  const replyMetadata = options.delegateReplyMetadata?.get(metadataSessionId);

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
    task: replyMetadata?.task,
    agent: replyMetadata?.agent,
    projectPath: replyMetadata?.projectPath,
    replyMode: replyMetadata?.replyMode,
    params: replyMetadata?.params,
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
    options: { forceNewProcess: true; delegateParentSessionId: string },
  ) => Promise<unknown>;
  setPermissionMode?: (sessionId: string, mode: string) => Promise<unknown>;
  switchAgent: (sessionId: string, agentName: string) => Promise<unknown>;
  setModelFromName?: CoordinatorSetModelFromName;
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
  delegateReplyMetadata?: Map<string, DelegateReplyMetadata>;
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
  // Sessions that timed out on the sync wait but were kept alive (#151 P1).
  // Added to when the sync timeout fires, so downstream logic (fallback reply,
  // status) can tell "timed out then completed" from "normal completion".
  syncDelegateTimedOut: Set<string>;
  now?: () => number;
  sessionIdFactory?: () => string;
}): Promise<DelegateSyncResult> {
  const { task, title, timeoutMs = 1800000 } = options.msg;
  const agent = options.msg.agent ?? options.msg.agentName;

  const session = await createAndStartDelegateSession({
    parentSessionId: options.parentSessionId,
    rawProjectPath: options.msg.projectPath,
    sessionIdPrefix: "sess_sub_",
    delegateType: "subagent",
    getActiveManaged: options.getActiveManaged,
    start: options.start,
    setPermissionMode: options.setPermissionMode,
    agent,
    parentChildMap: options.parentChildMap,
    delegateCreatedAt: options.delegateCreatedAt,
    delegateReplyCount: options.delegateReplyCount,
    now: options.now,
    sessionIdFactory: options.sessionIdFactory,
  });
  if (options.msg.model && options.setModelFromName) {
    try {
      await options.setModelFromName(session.sessionId, options.msg.model, {
        parentSessionId: options.parentSessionId,
        projectPath: session.projectPath,
      });
      log.info("[handleCoordinatorDelegateSync] model switched", {
        newSessionId: session.sessionId,
        model: options.msg.model,
      });
    } catch (modelErr: unknown) {
      log.warn("[handleCoordinatorDelegateSync] setModel failed, using default model", {
        newSessionId: session.sessionId,
        model: options.msg.model,
        err: modelErr instanceof Error ? modelErr.message : String(modelErr),
      });
    }
  }

  if (agent) {
    try {
      await options.switchAgent(session.sessionId, agent);
      log.info("[handleCoordinatorDelegateSync] agent switched", {
        newSessionId: session.sessionId,
        agent,
      });
    } catch (switchErr: unknown) {
      log.warn("[handleCoordinatorDelegateSync] switchAgent failed, aborting delegate", {
        newSessionId: session.sessionId,
        agent,
        err: switchErr instanceof Error ? switchErr.message : String(switchErr),
      });
      await cleanupFailedDelegateBootstrap({
        sessionId: session.sessionId,
        parentSessionId: options.parentSessionId,
        parentChildMap: options.parentChildMap,
        delegateCreatedAt: options.delegateCreatedAt,
        delegateReplyCount: options.delegateReplyCount,
        delegateReplyMetadata: options.delegateReplyMetadata,
        stop: options.stop,
      });
      throw buildRequiredAgentSwitchError({
        sessionId: session.sessionId,
        agent,
        err: switchErr,
      });
    }
  }

  const rawTitle = title ?? task.slice(0, 60);
  const sessionTitle = `子代理: ${rawTitle}`;
  options.delegateReplyMetadata?.set(session.sessionId, {
    task,
    title: sessionTitle,
    projectPath: session.projectPath,
    replyMode: "interrupt",
    agent,
    params: buildDelegateReplyParams({
      title: sessionTitle,
      agent,
      projectPath: session.projectPath,
      replyMode: "interrupt",
    }),
  });
  await options.setSessionName(session.sessionId, sessionTitle);
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
      // Mark the session as "timed out but kept alive" so the eventual
      // agent_end fallback reply and status queries can distinguish this
      // from a normal completion. The session stays in parentChildMap and
      // the process keeps running (see #151 P1).
      options.syncDelegateTimedOut.add(session.sessionId);
      resolve({
        sessionId: session.sessionId,
        status: "timeout",
        exitCode: 1,
        finalText: buildDelegateSyncTimeoutRecoveryText({
          sessionId: session.sessionId,
          timeoutMs,
          lastText,
        }),
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
        agent,
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

  if (syncResult.status !== "timeout") {
    await options.stop(session.sessionId);
    removeDelegateChild(options.parentChildMap, options.parentSessionId, session.sessionId);
  }

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
    options: { forceNewProcess: true; delegateParentSessionId: string },
  ) => Promise<{ status: "started" | "already_running" }>;
  switchAgent?: (sessionId: string, agentName: string) => Promise<unknown>;
  setModelFromName?: CoordinatorSetModelFromName;
  stop?: (sessionId: string) => Promise<unknown>;
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
  const agent = options.msg.agent ?? options.msg.agentName;
  if (!canManageDelegateChild(options.parentChildMap, options.parentSessionId, targetSessionId)) {
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
    delegateParentSessionId: options.parentSessionId,
  });

  registerDelegateChild(options.parentChildMap, options.parentSessionId, forkedSessionId);
  if (options.msg.model && options.setModelFromName) {
    try {
      await options.setModelFromName(forkedSessionId, options.msg.model, {
        parentSessionId: options.parentSessionId,
        projectPath,
      });
      log.info("[handleCoordinatorDelegateFork] model switched", {
        forkedSessionId,
        model: options.msg.model,
      });
    } catch (modelErr: unknown) {
      log.warn("[handleCoordinatorDelegateFork] setModel failed, using default model", {
        forkedSessionId,
        model: options.msg.model,
        err: modelErr instanceof Error ? modelErr.message : String(modelErr),
      });
    }
  }

  if (agent && options.switchAgent) {
    try {
      await options.switchAgent(forkedSessionId, agent);
      log.info("[handleCoordinatorDelegateFork] agent switched", {
        forkedSessionId,
        agent,
      });
    } catch (switchErr: unknown) {
      log.warn("[handleCoordinatorDelegateFork] switchAgent failed, aborting delegate", {
        forkedSessionId,
        agent,
        err: switchErr instanceof Error ? switchErr.message : String(switchErr),
      });
      await cleanupFailedDelegateBootstrap({
        sessionId: forkedSessionId,
        parentSessionId: options.parentSessionId,
        parentChildMap: options.parentChildMap,
        stop: options.stop,
      });
      throw buildRequiredAgentSwitchError({
        sessionId: forkedSessionId,
        agent,
        err: switchErr,
      });
    }
  }

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
}): Promise<DelegateStatusExt> {
  const { sessionId: targetSessionId } = options.msg;
  const parentChildren = options.parentChildMap.get(options.parentSessionId);
  const isDelegateChild = parentChildren?.has(targetSessionId) ?? false;

  // Fallback: even when the parent-child relation was cleared (e.g. after a
  // sync subagent timeout leaves orphan tracking, or cleanup ran), the session
  // may still exist on disk and be sendable. Mirror the send handler's check
  // (hasKnownDelegateSendTarget) so status and send agree on existence.
  // Without this, status returns "not_found" while session_delegate_send
  // succeeds — see issue #151.
  const sessionPath = options.sessionPaths.get(targetSessionId) ?? "";
  const sessionFileExists = Boolean(sessionPath && existsSync(sessionPath));

  if (!isDelegateChild && !sessionFileExists) {
    return {
      task: null,
      status: "not_found",
      detail: buildDelegateStatusDetail("not_found", undefined, false),
      isCompacting: false,
      contextUsage: { tokens: null, contextWindow: 0, percent: null },
    };
  }

  const status = options.getStatus(targetSessionId);
  if (status.status === "stopped") {
    const hasRecord =
      options.sessionPaths.has(targetSessionId) || options.sessionProjectPaths.has(targetSessionId);
    // Three cases:
    //  - delegate child + record: "stopped" (resumable)
    //  - non-child but session file exists on disk: "stopped" (send handler
    //    can still restart it — see hasKnownDelegateSendTarget). Keeps
    //    status/send consistent per issue #151.
    //  - everything else: "not_found"
    const resolvedStatus =
      hasRecord || (!isDelegateChild && sessionFileExists) ? "stopped" : "not_found";
    return {
      task: null,
      status: resolvedStatus,
      detail: buildDelegateStatusDetail(resolvedStatus, sessionPath || undefined, false),
      isCompacting: false,
      contextUsage: { tokens: null, contextWindow: 0, percent: null },
    };
  }

  const state = await options.getState(targetSessionId);
  const contextUsage = await options.getContextUsage(targetSessionId);
  const isCompacting = state?.isCompacting ?? false;
  const resolvedStatus = state?.isStreaming
    ? "streaming"
    : hasAssistantMessage(sessionPath || undefined)
      ? "completed"
      : "idle";

  return {
    task: null,
    status: resolvedStatus,
    detail: buildDelegateStatusDetail(resolvedStatus, sessionPath || undefined, isCompacting),
    isCompacting,
    contextUsage,
  };
}

function buildDelegateStatusDetail(
  status: string,
  sessionPath: string | undefined,
  isCompacting: boolean,
): DelegateStatusDetail {
  const waitingType: DelegateStatusWaitingType = isCompacting
    ? "compacting"
    : status === "streaming" ||
        status === "completed" ||
        status === "idle" ||
        status === "stopped" ||
        status === "not_found"
      ? status
      : "idle";
  const phase = (() => {
    if (isCompacting) return "压缩中";
    if (status === "streaming") return "执行中";
    if (status === "completed") return "已完成";
    if (status === "stopped") return "已停止";
    if (status === "not_found") return "未找到会话";
    return "空闲";
  })();

  return {
    phase,
    waitingType,
    waitingSince: Date.now(),
    lastMessages: readRecentMessageSummaries(sessionPath),
  };
}

function readRecentMessageSummaries(sessionPath: string | undefined, limit = 3): string[] {
  if (!sessionPath || !existsSync(sessionPath)) return [];
  try {
    const summaries: string[] = [];
    const lines = readFileSync(sessionPath, "utf-8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0 && summaries.length < limit; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const summary = summarizeSessionMessageLine(line);
      if (summary) summaries.unshift(summary);
    }
    return summaries;
  } catch {
    return [];
  }
}

function summarizeSessionMessageLine(line: string): string | undefined {
  try {
    const entry = JSON.parse(line) as unknown;
    if (!entry || typeof entry !== "object") return undefined;
    const record = entry as Record<string, unknown>;
    if (record.type !== "message") return undefined;
    const message = record.message;
    if (!message || typeof message !== "object") return undefined;
    const msg = message as Record<string, unknown>;
    const role = typeof msg.role === "string" ? msg.role : undefined;
    if (!role) return undefined;
    const text = extractMessageText(msg.content);
    if (!text) return undefined;
    const label = role === "user" ? "用户" : role === "assistant" ? "助手" : "工具";
    return `${label}: ${text.length > 120 ? `${text.slice(0, 120)}...` : text}`;
  } catch {
    return undefined;
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    if (typeof block.text === "string") parts.push(block.text);
    else if (typeof block.thinking === "string") parts.push(block.thinking);
    else if (typeof block.name === "string") parts.push(`调用 ${block.name}`);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
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
