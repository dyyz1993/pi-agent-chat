import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { getProcessManager } from "./agent";

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("supervisor.getStatus", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm)
      return {
        enabled: false,
        state: "disabled" as const,
        continueCount: 0,
        maxContinueCount: 0,
        activeGuards: [],
      };
    return pm.callChannel(sessionId, "supervisor", "getStatus", {}) as Promise<
      import("../modules/supervisor").SupervisorStatus
    >;
  });

  r("supervisor.requestPause", async (params) => {
    const { sessionId, delayMs, reason } = params as {
      sessionId: string;
      delayMs?: number;
      reason?: string;
    };
    const pm = getProcessManager();
    if (!pm) return { scheduled: false };
    return pm.callChannel(sessionId, "supervisor", "requestPause", { delayMs, reason }) as Promise<{
      scheduled: boolean;
      scheduledAt?: number;
    }>;
  });

  r("supervisor.cancelPause", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { cancelled: false };
    return pm.callChannel(sessionId, "supervisor", "cancelPause", {}) as Promise<{
      cancelled: boolean;
    }>;
  });

  r("supervisor.forceContinue", async (params) => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const pm = getProcessManager();
    if (!pm) return { triggered: false };
    return pm.callChannel(sessionId, "supervisor", "forceContinue", { reason }) as Promise<{
      triggered: boolean;
    }>;
  });

  r("supervisor.disable", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { disabled: false };
    return pm.callChannel(sessionId, "supervisor", "disable", {}) as Promise<{ disabled: boolean }>;
  });

  r("supervisor.enable", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { enabled: false };
    return pm.callChannel(sessionId, "supervisor", "enable", {}) as Promise<{ enabled: boolean }>;
  });

  r("supervisor.getTaskReport", async (params) => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return { tasks: [] };
    return pm.callChannel(sessionId, "supervisor", "getTaskReport", {}) as Promise<{
      tasks: import("../modules/supervisor").TaskReport[];
    }>;
  });

  r("supervisor.checkToolStatus", async (params) => {
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
  });
}
