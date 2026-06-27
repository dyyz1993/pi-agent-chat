import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { forwardToChannel } from "./channel-helpers";

const EMPTY_RESULT: R<"hooks.getLog"> = {
  entries: [],
  ruleStats: [],
  totalExecutions: 0,
  configSnapshot: { runtimeEnabled: true, skippedRules: [], sources: [], events: [] },
};

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("hooks.getLog", async (params) => {
    const result = await forwardToChannel<R<"hooks.getLog">>(params, "hooks", "hooks.getLog", {
      limit: params.limit,
      event: params.event,
    });
    return result ?? EMPTY_RESULT;
  });

  r("hooks.getConfig", async (params) => {
    const result = await forwardToChannel<R<"hooks.getConfig">>(
      params,
      "hooks",
      "hooks.getConfig",
      {},
    );
    return result ?? EMPTY_RESULT;
  });

  r("hooks.clear", async (params) => {
    const result = await forwardToChannel<R<"hooks.clear">>(params, "hooks", "hooks.clear", {});
    return result ?? { ok: false };
  });

  r("hooks.getStatus", async (params) => {
    const result = await forwardToChannel<R<"hooks.getStatus">>(
      params,
      "hooks",
      "hooks.getStatus",
      {},
    );
    return result ?? { enabled: true };
  });

  r("hooks.setEnabled", async (params) => {
    const result = await forwardToChannel<R<"hooks.setEnabled">>(
      params,
      "hooks",
      "hooks.setEnabled",
      { enabled: params.enabled },
    );
    return result ?? { enabled: true };
  });

  r("hooks.skipRule", async (params) => {
    const result = await forwardToChannel<R<"hooks.skipRule">>(params, "hooks", "hooks.skipRule", {
      event: params.event,
      matcher: params.matcher,
    });
    return result ?? { skipped: [] };
  });

  r("hooks.unskipRule", async (params) => {
    const result = await forwardToChannel<R<"hooks.unskipRule">>(
      params,
      "hooks",
      "hooks.unskipRule",
      { event: params.event, matcher: params.matcher },
    );
    return result ?? { skipped: [] };
  });

  r("hooks.getSkippedRules", async (params) => {
    const result = await forwardToChannel<R<"hooks.getSkippedRules">>(
      params,
      "hooks",
      "hooks.getSkippedRules",
      {},
    );
    return result ?? { skipped: [] };
  });
}
