import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { GoalState, SupervisorStatus, TaskReport, TriggerRecord } from "../modules/supervisor";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { forwardToChannel } from "./channel-helpers";

const log = createLogger("supervisor");
const STATUS_TIMEOUT_MS = 2500;
const CHANNEL_TIMEOUT_MS = 5_000;
const REFINE_TIMEOUT_MS = 60_000;

function disabledStatus(): SupervisorStatus {
  return {
    enabled: false,
    state: "disabled",
    continueCount: 0,
    maxContinueCount: 0,
    activeGuards: [],
  };
}

async function getSupervisorStatus(
  pm: NonNullable<ReturnType<typeof getProcessManager>>,
  sessionId: string,
): Promise<SupervisorStatus> {
  try {
    const result: unknown = await withTimeout(
      pm.callChannel(sessionId, "supervisor", "getStatus", {}),
      STATUS_TIMEOUT_MS,
    );
    return result as SupervisorStatus;
  } catch (err: unknown) {
    log.warn("getStatus channel call failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return disabledStatus();
  }
}

function blockedGoal(objective: string, summary: string): { goal: GoalState } {
  return {
    goal: {
      id: "",
      objective,
      status: "blocked",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      continuationCount: 0,
      blockers: [{ kind: "runtime", summary }],
    },
  };
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("supervisor.getStatus", async (params): Promise<SupervisorStatus> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return disabledStatus();
    return getSupervisorStatus(pm, sessionId);
  });

  r(
    "supervisor.requestPause",
    async (params): Promise<{ scheduled: boolean; scheduledAt?: number }> => {
      const { sessionId, delayMs, reason } = params as {
        sessionId: string;
        delayMs?: number;
        reason?: string;
      };
      const result = await forwardToChannel<{ scheduled: boolean; scheduledAt?: number }>(
        { sessionId },
        "supervisor",
        "requestPause",
        { delayMs, reason },
        CHANNEL_TIMEOUT_MS,
        { skipHasSessionCheck: true },
      );
      if (!result) log.warn("supervisor.requestPause channel call failed", { sessionId });
      return result ?? { scheduled: false };
    },
  );

  r("supervisor.cancelPause", async (params): Promise<{ cancelled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ cancelled: boolean }>(
      { sessionId },
      "supervisor",
      "cancelPause",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.cancelPause channel call failed", { sessionId });
    return result ?? { cancelled: false };
  });

  r("supervisor.forceContinue", async (params): Promise<{ triggered: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ triggered: boolean }>(
      { sessionId },
      "supervisor",
      "forceContinue",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.forceContinue channel call failed", { sessionId });
    return result ?? { triggered: false };
  });

  r("supervisor.disable", async (params): Promise<{ disabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ disabled: boolean }>(
      { sessionId },
      "supervisor",
      "disable",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.disable channel call failed", { sessionId });
    return result ?? { disabled: false };
  });

  r("supervisor.enable", async (params): Promise<{ enabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ enabled: boolean }>(
      { sessionId },
      "supervisor",
      "enable",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.enable channel call failed", { sessionId });
    return result ?? { enabled: false };
  });

  r("supervisor.getTaskReport", async (params): Promise<{ tasks: TaskReport[] }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ tasks: TaskReport[] }>(
      { sessionId },
      "supervisor",
      "getTaskReport",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.getTaskReport channel call failed", { sessionId });
    return result ?? { tasks: [] };
  });

  r(
    "supervisor.checkToolStatus",
    async (params): Promise<{ reachable: boolean; status?: string; error?: string }> => {
      const { sessionId, toolName, channelName, method } = params as {
        sessionId: string;
        toolName: string;
        channelName?: string;
        method?: string;
      };
      const result = await forwardToChannel<{
        reachable: boolean;
        status?: string;
        error?: string;
      }>(
        { sessionId },
        "supervisor",
        "checkToolStatus",
        { toolName, channelName, method },
        CHANNEL_TIMEOUT_MS,
        { skipHasSessionCheck: true },
      );
      if (!result) {
        log.warn("supervisor.checkToolStatus channel call failed", { sessionId });
      }
      return result ?? { reachable: false, error: "Channel call failed" };
    },
  );

  r("supervisor.setGoal", async (params): Promise<{ goal: GoalState }> => {
    const { sessionId, objective } = params as { sessionId: string; objective: string };
    const pm = getProcessManager();
    if (!pm) {
      return blockedGoal(objective, "Agent process manager unavailable");
    }
    const result = await forwardToChannel<{ goal: GoalState }>(
      { sessionId },
      "supervisor",
      "setGoal",
      { objective },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (result) return result;
    log.warn("supervisor.setGoal channel call failed", { sessionId });
    return blockedGoal(objective, "Channel call failed");
  });

  r("supervisor.clearGoal", async (params): Promise<{ cleared: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ cleared: boolean }>(
      { sessionId },
      "supervisor",
      "clearGoal",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.clearGoal channel call failed", { sessionId });
    return result ?? { cleared: false };
  });

  r(
    "supervisor.refineGoal",
    async (params): Promise<{ success: boolean; objective?: string; error?: string }> => {
      const { sessionId, objective } = params as {
        sessionId: string;
        objective: string;
      };
      const pm = getProcessManager();
      if (!pm) return { success: false, error: "Agent process manager unavailable" };
      try {
        const result = (await withTimeout(
          pm.callChannel(sessionId, "supervisor", "refineGoal", {
            objective,
          }),
          REFINE_TIMEOUT_MS,
        )) as { success: boolean; objective?: string; error?: string };
        return result;
      } catch (err) {
        log.warn("supervisor.refineGoal channel call failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  r("supervisor.getTriggerHistory", async (params): Promise<{ triggers: TriggerRecord[] }> => {
    const { sessionId, limit } = params as { sessionId: string; limit?: number };
    const result = await forwardToChannel<{ triggers: TriggerRecord[] }>(
      { sessionId },
      "supervisor",
      "getTriggerHistory",
      { limit: limit ?? 50 },
      STATUS_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.getTriggerHistory channel call failed", { sessionId });
    return result ?? { triggers: [] };
  });
}
