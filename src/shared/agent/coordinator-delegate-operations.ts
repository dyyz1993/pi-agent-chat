import { copyFileSync, existsSync } from "fs";
import * as path from "path";

import type { CoordinatorMethodCall } from "../modules/coordinator";
import { createLogger } from "../lib/logger";
import {
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
  ) => Promise<{ status: "started" | "already_running" | "switched" }>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  send: (sessionId: string, content: string) => void;
  broadcastEvent: (
    eventName: string,
    data: Record<string, unknown>,
    filter: Record<string, unknown>,
  ) => Promise<void>;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  now?: () => number;
  sessionIdFactory?: () => string;
}): Promise<{ sessionId: string; status: "started" | "already_running" | "switched" }> {
  const { task, projectPath: rawProjectPath } = options.msg;
  const parent = options.getActiveManaged(options.parentSessionId);
  if (!parent) throw new Error("Parent session not found");

  const newSessionId =
    options.sessionIdFactory?.() ??
    `sess_coord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { projectPath, sessionPath } = resolveDelegateSessionPaths({
    parentProjectPath: parent.info.projectPath,
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
      delegateType: "coordinator",
    });
  } catch (writeErr: unknown) {
    log.warn("[handleCoordinatorDelegate] failed to write session header", {
      sessionPath,
      err: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  const result = await options.start(newSessionId, projectPath, sessionPath, {
    forceNewProcess: true,
  });

  const createdAt = (options.now ?? Date.now)();
  options.delegateCreatedAt.set(newSessionId, createdAt);
  options.delegateReplyCount.set(newSessionId, 0);
  registerDelegateChild(options.parentChildMap, options.parentSessionId, newSessionId);

  const rawTitle = options.msg.title ?? task.slice(0, 60);
  const title = `指派: ${rawTitle}`;
  await options.setSessionName(newSessionId, title);
  const delegatePrompt = buildCoordinatorDelegatePrompt({
    newSessionId,
    parentSessionId: options.parentSessionId,
    title,
    task,
    projectPath,
  });

  options.send(newSessionId, delegatePrompt);

  options
    .broadcastEvent(
      "coordinator.session_created",
      buildCoordinatorSessionCreatedEvent({
        parentSessionId: options.parentSessionId,
        sessionId: newSessionId,
        name: title,
        sessionPath,
        projectPath,
        parentSessionPath: parent.info.sessionPath,
        delegateType: "coordinator",
        firstMessage: task,
        createdAt,
      }),
      { parentSessionId: options.parentSessionId },
    )
    .catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId: options.parentSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  return { sessionId: newSessionId, status: result.status };
}

export async function handleCoordinatorDelegateSendOperation<
  TManaged extends DelegateSendManaged,
>(options: {
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>;
  clients: Map<string, TManaged>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  delegateReplyCount: Map<string, number>;
  delegateCreatedAt: Map<string, number>;
  parentChildMap: DelegateChildMap;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ status: "started" | "already_running" | "switched" }>;
  send: (sessionId: string, content: string) => void;
  steer: (sessionId: string, content: string) => void;
  followUp: (sessionId: string, content: string) => void;
  now?: () => number;
}): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
  const { targetSessionId, message } = options.msg;

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
      return { delivered: false, targetStatus: "not_found" };
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
    targetSessionId,
    title,
    sequence: count,
    createdAt,
    elapsed,
    message,
  });

  if (options.msg.mode === "steer") {
    options.steer(targetSessionId, wrappedMessage);
  } else if (options.msg.mode === "followUp" || target.info.status === "streaming") {
    options.followUp(targetSessionId, wrappedMessage);
  } else {
    options.send(targetSessionId, wrappedMessage);
  }

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
    data: Record<string, unknown>,
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
  const { task, title, agent, timeoutMs = 1800000, projectPath: rawProjectPath } = options.msg;
  const parent = options.getActiveManaged(options.parentSessionId);
  if (!parent) throw new Error("Parent session not found");

  const newSessionId =
    options.sessionIdFactory?.() ??
    `sess_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const { projectPath, sessionPath } = resolveDelegateSessionPaths({
    parentProjectPath: parent.info.projectPath,
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
      delegateType: "subagent",
    });
  } catch (writeErr: unknown) {
    log.warn("[handleCoordinatorDelegateSync] failed to write session header", {
      sessionPath,
      err: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  await options.start(newSessionId, projectPath, sessionPath, { forceNewProcess: true });

  if (agent) {
    try {
      await options.switchAgent(newSessionId, agent);
      log.info("[handleCoordinatorDelegateSync] agent switched", { newSessionId, agent });
    } catch (switchErr: unknown) {
      log.warn("[handleCoordinatorDelegateSync] switchAgent failed, using default agent", {
        newSessionId,
        agent,
        err: switchErr instanceof Error ? switchErr.message : String(switchErr),
      });
    }
  }

  const createdAt = (options.now ?? Date.now)();
  options.delegateCreatedAt.set(newSessionId, createdAt);
  options.delegateReplyCount.set(newSessionId, 0);
  registerDelegateChild(options.parentChildMap, options.parentSessionId, newSessionId);

  const rawTitle = title ?? task.slice(0, 60);
  await options.setSessionName(newSessionId, `子代理: ${rawTitle}`);
  const delegatePrompt = buildSyncDelegatePrompt({ task, rawTitle, agent, projectPath });

  options.subagentSyncChildren.add(newSessionId);
  const syncPromise = new Promise<DelegateSyncResult>((resolve) => {
    const preTimeoutMs = Math.max(timeoutMs - 60_000, 30_000);
    const preTimeout = setTimeout(() => {
      if (!options.syncDelegateResolvers.has(newSessionId)) return;
      log.info("[syncDelegate] pre-timeout summarize injection", { sessionId: newSessionId });
      options.steer(
        newSessionId,
        `[系统指令] 任务已运行较长时间（${Math.round((timeoutMs - 60_000) / 60_000)} 分钟），请在 60 秒内汇报阶段性成果：已完成的工作、未完成的部分、以及下一步该怎么做，以便主任务可以恢复继续。`,
      );
    }, preTimeoutMs);

    const timeout = setTimeout(() => {
      clearTimeout(preTimeout);
      log.warn("[syncDelegate] timed out", {
        sessionId: newSessionId,
        parentSessionId: options.parentSessionId,
        timeoutMs,
      });
      const lastText = options.syncDelegateLastText.get(newSessionId) ?? "";
      options.syncDelegateResolvers.delete(newSessionId);
      options.subagentSyncChildren.delete(newSessionId);
      options.syncDelegateLastText.delete(newSessionId);
      resolve({
        sessionId: newSessionId,
        status: "timeout",
        exitCode: 1,
        finalText: lastText || "(timed out, no output captured)",
      });
    }, timeoutMs);

    options.syncDelegateResolvers.set(newSessionId, {
      resolve,
      timeout,
      parentSessionId: options.parentSessionId,
    });
  });

  options.send(newSessionId, delegatePrompt);
  options
    .broadcastEvent(
      "coordinator.session_created",
      buildCoordinatorSessionCreatedEvent({
        parentSessionId: options.parentSessionId,
        sessionId: newSessionId,
        name: rawTitle,
        sessionPath,
        projectPath,
        parentSessionPath: parent.info.sessionPath,
        delegateType: "subagent",
        firstMessage: task,
        createdAt,
      }),
      { parentSessionId: options.parentSessionId },
    )
    .catch((err: unknown) => {
      log.warn("broadcastEvent(coordinator.session_created) error", {
        parentSessionId: options.parentSessionId,
        newSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  options
    .broadcastEvent(
      "subagent.event",
      {
        parentSessionId: options.parentSessionId,
        parentSessionPath: parent.info.sessionPath,
        subSessionId: newSessionId,
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
        newSessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });

  const syncResult = await syncPromise;

  await options.stop(newSessionId);
  removeDelegateChild(options.parentChildMap, options.parentSessionId, newSessionId);

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
  ) => Promise<{ status: "started" | "already_running" | "switched" }>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  send: (sessionId: string, content: string) => void;
  broadcastEvent: (
    eventName: string,
    data: Record<string, unknown>,
    filter: Record<string, unknown>,
  ) => Promise<void>;
  parentChildMap: DelegateChildMap;
  sessionIdFactory?: () => string;
}): Promise<{ sessionId: string; status: "started" | "already_running" | "switched" }> {
  const { task, sessionId: targetSessionId } = options.msg;
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
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>;
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
    status: state?.isStreaming ? "streaming" : "idle",
    isCompacting: state?.isCompacting ?? false,
    contextUsage,
  };
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
  return { ok };
}
