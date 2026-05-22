import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createLogger } from "../lib/logger";
import { getProcessManager } from "./agent";

const log = createLogger("change-review");

const CHANNEL_TIMEOUT_MS = 5_000;

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

  r("change-review.pending", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return [] as unknown as R<"change-review.pending">;
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", "review.pending", {
          sessionId: params.sessionId,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return (Array.isArray(result) ? result : []) as unknown as R<"change-review.pending">;
    } catch (err) {
      log.warn("review.pending channel call failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [] as unknown as R<"change-review.pending">;
    }
  });

  r("change-review.approve", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false };
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", "review.approve", {
          sessionId: params.sessionId,
          turnIndex: params.turnIndex,
          path: params.path,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return (result ?? { ok: false }) as R<"change-review.approve">;
    } catch (err) {
      log.warn("review.approve channel call failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { ok: false };
    }
  });

  r("change-review.reject", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false };
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", "review.reject", {
          sessionId: params.sessionId,
          turnIndex: params.turnIndex,
          path: params.path,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return (result ?? { ok: false }) as R<"change-review.reject">;
    } catch (err) {
      log.warn("review.reject channel call failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { ok: false };
    }
  });

  r("change-review.approveAll", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { count: 0 };
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", "review.approveAll", {
          sessionId: params.sessionId,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return ((result as { count: number } | null) ?? {
        count: 0,
      }) as R<"change-review.approveAll">;
    } catch (err) {
      log.warn("review.approveAll channel call failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { count: 0 };
    }
  });
}
