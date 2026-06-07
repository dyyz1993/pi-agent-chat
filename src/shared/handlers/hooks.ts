import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { getProcessManager } from "./agent";

const EMPTY_RESULT: R<"hooks.getLog"> = {
  entries: [],
  ruleStats: [],
  totalExecutions: 0,
  configSnapshot: { runtimeEnabled: true, sources: [], events: [] },
};

const CHANNEL_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`channel call timed out (${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("hooks.getLog", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        const result = await withTimeout(
          manager.callChannel(params.sessionId, "hooks", "hooks.getLog", {
            limit: params.limit,
            event: params.event,
          }),
          CHANNEL_TIMEOUT_MS,
        );
        return result as R<"hooks.getLog">;
      } catch {
        return EMPTY_RESULT;
      }
    }
    return EMPTY_RESULT;
  });

  r("hooks.getConfig", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        const result = await withTimeout(
          manager.callChannel(params.sessionId, "hooks", "hooks.getConfig", {}),
          CHANNEL_TIMEOUT_MS,
        );
        return result as R<"hooks.getConfig">;
      } catch {
        return EMPTY_RESULT;
      }
    }
    return EMPTY_RESULT;
  });

  r("hooks.clear", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        const result = await withTimeout(
          manager.callChannel(params.sessionId, "hooks", "hooks.clear", {}),
          CHANNEL_TIMEOUT_MS,
        );
        return result as R<"hooks.clear">;
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  });

  r("hooks.getStatus", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        const result = await withTimeout(
          manager.callChannel(params.sessionId, "hooks", "hooks.getStatus", {}),
          CHANNEL_TIMEOUT_MS,
        );
        return result as R<"hooks.getStatus">;
      } catch {
        return { enabled: true };
      }
    }
    return { enabled: true };
  });

  r("hooks.setEnabled", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      try {
        const result = await withTimeout(
          manager.callChannel(params.sessionId, "hooks", "hooks.setEnabled", {
            enabled: params.enabled,
          }),
          CHANNEL_TIMEOUT_MS,
        );
        return result as R<"hooks.setEnabled">;
      } catch {
        return { enabled: true };
      }
    }
    return { enabled: true };
  });
}
