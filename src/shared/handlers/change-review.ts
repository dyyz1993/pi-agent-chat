import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { getProcessManager } from "./agent";
import { FILE_REVIEW_METHODS } from "../constants/channel-methods";
import { existsSync, createReadStream } from "fs";
import * as readline from "readline";
import type { PendingChangeResult } from "../modules/change-review";

const log = createLogger("change-review");

const CHANNEL_TIMEOUT_MS = 5_000;

interface TurnChange {
  turnIndex: number;
  timestamp: number;
  changes: Array<{ path: string; status: string }>;
}

interface ApprovalRecord {
  path: string;
  status: "approved" | "rejected";
  timestamp: number;
}

/**
 * Read pending changes from session JSONL when CLI process is not available.
 * Returns list without oldContent/newContent (process required for diff data).
 */
async function readPendingFromJsonl(sessionPath: string): Promise<PendingChangeResult[]> {
  if (!sessionPath || !existsSync(sessionPath)) return [];

  const turns: TurnChange[] = [];
  const approvals = new Map<string, ApprovalRecord>();
  const everApproved = new Set<string>();

  const maxTurnIndexAtLastApproval = new Map<string, number>();

  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let currentMaxTurn = -1;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type !== "custom") continue;

      if (entry.customType === "file-review-turn") {
        const data = entry.data as
          | {
              turnIndex: number;
              timestamp: number;
              changes: Array<{ path: string; status: string }>;
            }
          | undefined;
        if (!data) continue;
        turns.push({ turnIndex: data.turnIndex, timestamp: data.timestamp, changes: data.changes });
        if (data.turnIndex > currentMaxTurn) currentMaxTurn = data.turnIndex;
      } else if (entry.customType === "file-approval") {
        const data = entry.data as
          | { path: string; status: "approved" | "rejected"; timestamp: number }
          | undefined;
        if (!data) continue;
        approvals.set(data.path, {
          path: data.path,
          status: data.status,
          timestamp: data.timestamp,
        });
        if (data.status === "approved") everApproved.add(data.path);
        maxTurnIndexAtLastApproval.set(data.path, currentMaxTurn);
      }
    } catch {}
  }
  rl.close();

  if (turns.length === 0) return [];

  type PathMeta = {
    firstStatus: string;
    latestTurnIndex: number;
    latestFileStatus: string;
    latestTimestamp: number;
  };
  const pathMeta = new Map<string, PathMeta>();

  for (const turn of turns) {
    for (const change of turn.changes) {
      const existing = pathMeta.get(change.path);
      if (!existing) {
        pathMeta.set(change.path, {
          firstStatus: change.status,
          latestTurnIndex: turn.turnIndex,
          latestFileStatus: change.status,
          latestTimestamp: turn.timestamp,
        });
      } else {
        existing.latestTurnIndex = turn.turnIndex;
        existing.latestFileStatus = change.status;
        existing.latestTimestamp = turn.timestamp;
      }
    }
  }

  const result: PendingChangeResult[] = [];
  for (const [path, meta] of pathMeta) {
    const approval = approvals.get(path);
    const approvalTurn = maxTurnIndexAtLastApproval.get(path) ?? -1;
    if (
      approval &&
      (approval.status === "approved" || approval.status === "rejected") &&
      meta.latestTurnIndex <= approvalTurn
    )
      continue;

    if (
      meta.firstStatus === "added" &&
      meta.latestFileStatus === "deleted" &&
      !everApproved.has(path)
    ) {
      continue;
    }

    result.push({
      turnIndex: meta.latestTurnIndex,
      path,
      fileStatus: meta.latestFileStatus as PendingChangeResult["fileStatus"],
      status: "pending",
      timestamp: meta.latestTimestamp,
      oldContent: null,
      newContent: null,
    });
  }

  return result;
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("change-review.pending", async (params) => {
    const manager = getProcessManager();

    // CLI process available → call file-review channel (optimized getBatchFileContents O(M))
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result: unknown = await withTimeout(
          manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.PENDING, {
            sessionId: params.sessionId,
          }),
          CHANNEL_TIMEOUT_MS,
        );
        const items = Array.isArray(result)
          ? result
          : Array.isArray((result as Record<string, unknown>)?.result)
            ? ((result as Record<string, unknown>).result as unknown[])
            : [];
        return items as unknown as R<"change-review.pending">;
      } catch (err: unknown) {
        log.warn("review.pending channel call failed, falling back to JSONL", {
          sessionId: params.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // No CLI process or channel call failed → read pending list from JSONL
    if (!params.sessionPath) return [];
    try {
      const items = await readPendingFromJsonl(params.sessionPath);
      return items as unknown as R<"change-review.pending">;
    } catch (err) {
      log.warn("review.pending JSONL read failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  });

  r("change-review.approve", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false };
    }

    try {
      const result: unknown = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.APPROVE, {
          sessionId: params.sessionId,
          path: params.path,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return (result ?? { ok: false }) as R<"change-review.approve">;
    } catch (err: unknown) {
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
      const result: unknown = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.REJECT, {
          sessionId: params.sessionId,
          path: params.path,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return (result ?? { ok: false }) as R<"change-review.reject">;
    } catch (err: unknown) {
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
      const result: unknown = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.APPROVE_ALL, {
          sessionId: params.sessionId,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return ((result as { count: number } | null) ?? {
        count: 0,
      }) as R<"change-review.approveAll">;
    } catch (err: unknown) {
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
      const result: unknown = await withTimeout(
        manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.REJECT_ALL, {
          sessionId: params.sessionId,
        }),
        CHANNEL_TIMEOUT_MS,
      );
      return ((result as { count: number; rolledBack: number } | null) ?? {
        count: 0,
        rolledBack: 0,
      }) as R<"change-review.rejectAll">;
    } catch (err: unknown) {
      log.warn("review.rejectAll channel call failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { count: 0, rolledBack: 0 };
    }
  });
}
