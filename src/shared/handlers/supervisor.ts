import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { SupervisorStatus, TaskReport } from "../modules/supervisor";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";

const log = createLogger("supervisor");
const STATUS_TIMEOUT_MS = 2500;

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
  let settled = false;
  const status = pm
    .callChannel(sessionId, "supervisor", "getStatus", {})
    .then((result) => result as SupervisorStatus)
    .catch((err: unknown) => {
      log.warn("getStatus channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return disabledStatus();
    })
    .finally(() => {
      settled = true;
    });

  const timeout = new Promise<SupervisorStatus>((resolve) => {
    setTimeout(() => {
      if (!settled) {
        log.warn("getStatus channel call timed out, returning disabled status", {
          sessionId,
          timeoutMs: STATUS_TIMEOUT_MS,
        });
      }
      resolve(disabledStatus());
    }, STATUS_TIMEOUT_MS);
  });

  return Promise.race([status, timeout]);
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
      return pm.callChannel(sessionId, "supervisor", "requestPause", {
        delayMs,
        reason,
      }) as Promise<{ scheduled: boolean; scheduledAt?: number }>;
    },
  );

  r("supervisor.cancelPause", async (params): Promise<{ cancelled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { cancelled: false };
    return pm.callChannel(sessionId, "supervisor", "cancelPause", {}) as Promise<{
      cancelled: boolean;
    }>;
  });

  r("supervisor.forceContinue", async (params): Promise<{ triggered: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const pm = getProcessManager();
    if (!pm) return { triggered: false };
    return pm.callChannel(sessionId, "supervisor", "forceContinue", { reason }) as Promise<{
      triggered: boolean;
    }>;
  });

  r("supervisor.disable", async (params): Promise<{ disabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { disabled: false };
    return pm.callChannel(sessionId, "supervisor", "disable", {}) as Promise<{ disabled: boolean }>;
  });

  r("supervisor.enable", async (params): Promise<{ enabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { enabled: false };
    return pm.callChannel(sessionId, "supervisor", "enable", {}) as Promise<{ enabled: boolean }>;
  });

  r("supervisor.getTaskReport", async (params): Promise<{ tasks: TaskReport[] }> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { tasks: [] };
    return pm.callChannel(sessionId, "supervisor", "getTaskReport", {}) as Promise<{
      tasks: TaskReport[];
    }>;
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
      return pm.callChannel(sessionId, "supervisor", "checkToolStatus", {
        toolName,
        channelName,
        method,
      }) as Promise<{ reachable: boolean; status?: string; error?: string }>;
    },
  );
}
