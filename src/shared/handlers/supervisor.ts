import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { GoalState, SupervisorStatus, TaskReport } from "../modules/supervisor";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";

const log = createLogger("supervisor");
const STATUS_TIMEOUT_MS = 2500;
const CHANNEL_TIMEOUT_MS = 1_000;
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
      const pm = getProcessManager();
      if (!pm) return { scheduled: false };
      try {
        return (await withTimeout(
          pm.callChannel(sessionId, "supervisor", "requestPause", {
            delayMs,
            reason,
          }),
          CHANNEL_TIMEOUT_MS,
        )) as { scheduled: boolean; scheduledAt?: number };
      } catch (err) {
        log.warn("supervisor.requestPause channel call failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return { scheduled: false };
      }
    },
  );

  r("supervisor.cancelPause", async (params): Promise<{ cancelled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { cancelled: false };
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "cancelPause", {}),
        CHANNEL_TIMEOUT_MS,
      )) as { cancelled: boolean };
    } catch (err) {
      log.warn("supervisor.cancelPause channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { cancelled: false };
    }
  });

  r("supervisor.forceContinue", async (params): Promise<{ triggered: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const pm = getProcessManager();
    if (!pm) return { triggered: false };
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "forceContinue", { reason }),
        CHANNEL_TIMEOUT_MS,
      )) as { triggered: boolean };
    } catch (err) {
      log.warn("supervisor.forceContinue channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { triggered: false };
    }
  });

  r("supervisor.disable", async (params): Promise<{ disabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { disabled: false };
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "disable", {}),
        CHANNEL_TIMEOUT_MS,
      )) as { disabled: boolean };
    } catch (err) {
      log.warn("supervisor.disable channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { disabled: false };
    }
  });

  r("supervisor.enable", async (params): Promise<{ enabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { enabled: false };
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "enable", {}),
        CHANNEL_TIMEOUT_MS,
      )) as { enabled: boolean };
    } catch (err) {
      log.warn("supervisor.enable channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { enabled: false };
    }
  });

  r("supervisor.getTaskReport", async (params): Promise<{ tasks: TaskReport[] }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { tasks: [] };
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "getTaskReport", {}),
        CHANNEL_TIMEOUT_MS,
      )) as { tasks: TaskReport[] };
    } catch (err) {
      log.warn("supervisor.getTaskReport channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { tasks: [] };
    }
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
      const pm = getProcessManager();
      if (!pm) return { reachable: false, error: "No process manager" };
      try {
        return (await withTimeout(
          pm.callChannel(sessionId, "supervisor", "checkToolStatus", {
            toolName,
            channelName,
            method,
          }),
          CHANNEL_TIMEOUT_MS,
        )) as { reachable: boolean; status?: string; error?: string };
      } catch (err) {
        log.warn("supervisor.checkToolStatus channel call failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return { reachable: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  r("supervisor.setGoal", async (params): Promise<{ goal: GoalState }> => {
    const { sessionId, objective } = params as { sessionId: string; objective: string };
    const pm = getProcessManager();
    if (!pm) {
      return {
        goal: {
          id: "",
          objective,
          status: "blocked",
          startedAt: Date.now(),
          updatedAt: Date.now(),
          continuationCount: 0,
          blockers: [{ kind: "runtime", summary: "Agent process manager unavailable" }],
        },
      };
    }
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "setGoal", {
          objective,
        }),
        CHANNEL_TIMEOUT_MS,
      )) as { goal: GoalState };
    } catch (err) {
      log.warn("supervisor.setGoal channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return {
        goal: {
          id: "",
          objective,
          status: "blocked",
          startedAt: Date.now(),
          updatedAt: Date.now(),
          continuationCount: 0,
          blockers: [
            { kind: "runtime", summary: err instanceof Error ? err.message : String(err) },
          ],
        },
      };
    }
  });

  r("supervisor.clearGoal", async (params): Promise<{ cleared: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const pm = getProcessManager();
    if (!pm) return { cleared: false };
    try {
      return (await withTimeout(
        pm.callChannel(sessionId, "supervisor", "clearGoal", {
          reason,
        }),
        CHANNEL_TIMEOUT_MS,
      )) as { cleared: boolean };
    } catch (err) {
      log.warn("supervisor.clearGoal channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { cleared: false };
    }
  });

  r(
    "supervisor.refineGoal",
    async (
      params,
    ): Promise<{ success: boolean; objective?: string; error?: string }> => {
      const { sessionId, objective } = params as {
        sessionId: string;
        objective: string;
      };
      const pm = getProcessManager();
      if (!pm) return { success: false, error: "Agent process manager unavailable" };
      try {
        return (await withTimeout(
          pm.callChannel(sessionId, "supervisor", "refineGoal", {
            objective,
          }),
          REFINE_TIMEOUT_MS,
        )) as { success: boolean; objective?: string; error?: string };
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
}
