import { existsSync } from "fs";

import type { CoordinatorMethodCall } from "../modules/coordinator";
import { createLogger } from "../lib/logger";
import {
  canStopDelegateChild,
  findParentSession,
  listDelegateChildSessions,
  type DelegateChildMap,
  type DelegateClientInfo,
  type DelegateSessionList,
} from "./coordinator-session-state";
import { formatDelegateElapsed, wrapDelegateReply } from "./coordinator-delegate-utils";

const log = createLogger("agent");

interface DelegateSendManaged {
  info: {
    status: string;
    sessionPath: string;
  };
}

export async function handleCoordinatorDelegateSendOperation<TManaged extends DelegateSendManaged>(
  options: {
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
  },
): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
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

export async function handleCoordinatorDelegateStatusOperation(options: {
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_status" }>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  getStatus: (sessionId: string) => { status: "idle" | "streaming" | "stopped"; pid?: number };
  getState: (sessionId: string) => Promise<{ isStreaming?: boolean; isCompacting?: boolean } | null>;
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

export function handleCoordinatorDelegateListOperation<TClient extends DelegateClientInfo>(options: {
  parentSessionId: string;
  parentChildMap: DelegateChildMap;
  clients: Map<string, TClient>;
}): DelegateSessionList {
  return listDelegateChildSessions(options.parentChildMap, options.clients, options.parentSessionId);
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
