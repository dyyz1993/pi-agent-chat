import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createLogger } from "../lib/logger";
import { getProcessManager } from "./agent";
import { FILE_REVIEW_METHODS } from "../constants/channel-methods";

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
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.PENDING, {
          sessionId: params.sessionId,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      // ServerChannel wraps array responses as { result: [...], invokeId }
      const items = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)?.result)
          ? ((result as Record<string, unknown>).result as unknown[])
          : [];
      return items as unknown as R<"change-review.pending">;
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
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.APPROVE, {
          sessionId: params.sessionId,
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
      return { ok: false, error: "No session" };
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.REJECT, {
          sessionId: params.sessionId,
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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  r("change-review.approveAll", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { count: 0 };
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.APPROVE_ALL, {
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

  r("change-review.rejectAll", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { count: 0, rolledBack: 0 };
    }

    try {
      const result = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.REJECT_ALL, {
          sessionId: params.sessionId,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return ((result as { count: number; rolledBack: number } | null) ?? {
        count: 0,
        rolledBack: 0,
      }) as R<"change-review.rejectAll">;
    } catch (err) {
      log.warn("review.rejectAll channel call failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { count: 0, rolledBack: 0 };
    }
  });
}
