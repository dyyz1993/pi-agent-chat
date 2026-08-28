/**
 * Loop Scheduler RPC handler — bridges frontend to fork extension channel.
 */
import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { getProcessManager } from "./agent";
import type { LoopChannelResult } from "../modules/loop-scheduler";

const log = createLogger("loop-scheduler");
const CHANNEL_TIMEOUT_MS = 5_000;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("loop-scheduler.callChannel", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return {
        ok: false,
        error: "Agent is not running for this session.",
      } as LoopChannelResult as R<"loop-scheduler.callChannel">;
    }

    try {
      const result: unknown = await withTimeout(
        manager.callChannel(
          params.sessionId,
          "loop-scheduler",
          params.method,
          (params.args ?? {}) as Record<string, unknown>,
        ),
        CHANNEL_TIMEOUT_MS,
      );

      if (result && typeof result === "object") {
        return result as LoopChannelResult as R<"loop-scheduler.callChannel">;
      }

      return {
        ok: false,
        error: "Unexpected response from loop-scheduler extension.",
      } as LoopChannelResult as R<"loop-scheduler.callChannel">;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("loop-scheduler channel call failed", { method: params.method, err: msg });
      return {
        ok: false,
        error: msg.includes("not found") || msg.includes("Method")
          ? "loop-scheduler extension is not installed or not loaded."
          : msg,
      } as LoopChannelResult as R<"loop-scheduler.callChannel">;
    }
  });
}
