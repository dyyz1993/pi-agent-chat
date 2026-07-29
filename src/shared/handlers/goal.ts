/**
 * Goal channel RPC handler — forwards calls to the "goal" channel
 * (goal-vendor extension) in the CLI process.
 *
 * goal-vendor has its own triple-storage persistence (JSON mirror +
 * session entries + events.jsonl), so no disk fallback is needed here.
 * Pure channel forwarding.
 */

import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { GoalVendorStatus, GoalVendorTaskItem, GoalVendorTriggerRecord } from "../modules/goal";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";
import { forwardToChannel } from "./channel-helpers";

const log = createLogger("goal");
const STATUS_TIMEOUT_MS = 2500;
const CHANNEL_TIMEOUT_MS = 5_000;

function disabledStatus(): GoalVendorStatus {
  return {
    enabled: false,
    state: "disabled",
    rawStatus: "none",
    rawPhase: "none",
    continuationSequence: 0,
    turnCount: 0,
  };
}

async function getGoalStatus(sessionId: string): Promise<GoalVendorStatus> {
  const pm = getProcessManager();
  if (!pm) return disabledStatus();
  const result = await forwardToChannel<GoalVendorStatus>(
    { sessionId },
    "goal",
    "getStatus",
    {},
    STATUS_TIMEOUT_MS,
    { skipHasSessionCheck: true },
  );
  return result ?? disabledStatus();
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("goal.getStatus", async (params): Promise<GoalVendorStatus> => {
    const { sessionId } = params as { sessionId: string };
    return getGoalStatus(sessionId);
  });

  r("goal.startSetup", async (params) => {
    const { sessionId, objective } = params as { sessionId: string; objective: string };
    const result = await forwardToChannel<{ started: boolean; goalId?: string; error?: string }>(
      { sessionId },
      "goal",
      "startSetup",
      { objective },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.startSetup channel call failed", { sessionId });
    return result ?? { started: false, error: "Channel call failed" };
  });

  r("goal.approveContract", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ approved: boolean; error?: string }>(
      { sessionId },
      "goal",
      "approveContract",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.approveContract channel call failed", { sessionId });
    return result ?? { approved: false, error: "Channel call failed" };
  });

  r("goal.rejectContract", async (params) => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ rejected: boolean }>(
      { sessionId },
      "goal",
      "rejectContract",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.rejectContract channel call failed", { sessionId });
    return result ?? { rejected: false };
  });

  r("goal.clearGoal", async (params) => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ cleared: boolean }>(
      { sessionId },
      "goal",
      "clearGoal",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.clearGoal channel call failed", { sessionId });
    return result ?? { cleared: false };
  });

  r("goal.forceContinue", async (params) => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ triggered: boolean }>(
      { sessionId },
      "goal",
      "forceContinue",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.forceContinue channel call failed", { sessionId });
    return result ?? { triggered: false };
  });

  r("goal.disable", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ disabled: boolean }>(
      { sessionId },
      "goal",
      "disable",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.disable channel call failed", { sessionId });
    return result ?? { disabled: false };
  });

  r("goal.enable", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ enabled: boolean }>(
      { sessionId },
      "goal",
      "enable",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("goal.enable channel call failed", { sessionId });
    return result ?? { enabled: false };
  });

  r("goal.getTaskReport", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ tasks: GoalVendorTaskItem[] }>(
      { sessionId },
      "goal",
      "getTaskReport",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    return result ?? { tasks: [] };
  });

  r("goal.getTriggerHistory", async (params) => {
    const { sessionId, limit } = params as { sessionId: string; limit?: number };
    const result = await forwardToChannel<{ triggers: GoalVendorTriggerRecord[] }>(
      { sessionId },
      "goal",
      "getTriggerHistory",
      { limit },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    return result ?? { triggers: [] };
  });

  r("goal.refineGoal", async (params) => {
    const { sessionId, objective } = params as { sessionId: string; objective: string };
    const pm = getProcessManager();
    if (!pm) return { success: false, error: "No process manager" };
    try {
      const result = await pm.callChannel(sessionId, "goal", "refineGoal", { objective });
      return result as { success: boolean; objective?: string; error?: string };
    } catch (error) {
      log.warn("goal.refineGoal channel call failed", { sessionId, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  r("goal.checkToolStatus", async (params) => {
    const { sessionId, toolName, channelName, method } = params as {
      sessionId: string;
      toolName: string;
      channelName?: string;
      method?: string;
    };
    const result = await forwardToChannel<{ reachable: boolean; status?: string; error?: string }>(
      { sessionId },
      "goal",
      "checkToolStatus",
      { toolName, channelName, method },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    return result ?? { reachable: false, error: "Channel call failed" };
  });
}
