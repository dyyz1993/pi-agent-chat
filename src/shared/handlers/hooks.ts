import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { getProcessManager } from "./agent";

const EMPTY_RESULT: R<"hooks.getLog"> = {
  entries: [],
  ruleStats: [],
  totalExecutions: 0,
  configSnapshot: { sources: [], events: [] },
};

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("hooks.getLog", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      const result = await manager.callChannel(params.sessionId, "hooks", "hooks.getLog", {
        limit: params.limit,
        event: params.event,
      });
      return result as R<"hooks.getLog">;
    }
    return EMPTY_RESULT;
  });

  r("hooks.getConfig", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      const result = await manager.callChannel(params.sessionId, "hooks", "hooks.getConfig", {});
      return result as R<"hooks.getConfig">;
    }
    return EMPTY_RESULT;
  });

  r("hooks.clear", async (params) => {
    const manager = getProcessManager();
    if (manager && params.sessionId && manager.hasSession(params.sessionId)) {
      const result = await manager.callChannel(params.sessionId, "hooks", "hooks.clear", {});
      return result as R<"hooks.clear">;
    }
    return { ok: false };
  });
}
