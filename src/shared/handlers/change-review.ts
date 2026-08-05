import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { getProcessManager } from "./agent";
import { FILE_REVIEW_METHODS } from "../constants/channel-methods";
import { existsSync, createReadStream } from "fs";
import * as readline from "readline";
import type {
  ApprovalResult,
  PendingChangeResult,
  ReviewApprovalStatus,
} from "../modules/change-review";

const log = createLogger("change-review");

const CHANNEL_TIMEOUT_MS = 5_000;

interface TurnChange {
  turnIndex: number;
  timestamp: number;
  changes: Array<{ path: string; status: string }>;
}

interface ApprovalRecord {
  path: string;
  status: ReviewApprovalStatus;
  timestamp: number;
  snapshotEntryId?: string;
  snapshotTreeHash?: string;
}

interface ParsedReviewState {
  turns: TurnChange[];
  approvals: Map<string, ApprovalRecord>;
  everApproved: Set<string>;
  /**
   * Per-path: the highest turnIndex whose timestamp is <= the latest approval
   * timestamp for that path. Robust against out-of-order writes (compaction,
   * CLI restart) because it is computed from timestamps rather than the
   * physical line order in the JSONL.
   */
  maxTurnIndexAtLastApproval: Map<string, number>;
}

async function readReviewStateFromJsonl(sessionPath: string): Promise<ParsedReviewState> {
  const turns: TurnChange[] = [];
  const approvals = new Map<string, ApprovalRecord>();
  const everApproved = new Set<string>();

  if (!sessionPath || !existsSync(sessionPath)) {
    return { turns, approvals, everApproved, maxTurnIndexAtLastApproval: new Map() };
  }

  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

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
      } else if (entry.customType === "file-approval") {
        const data = entry.data as
          | {
              path: string;
              status: ReviewApprovalStatus;
              timestamp: number;
              snapshotEntryId?: string;
              snapshotTreeHash?: string;
            }
          | undefined;
        if (!data) continue;
        approvals.set(data.path, {
          path: data.path,
          status: data.status,
          timestamp: data.timestamp,
          snapshotEntryId: data.snapshotEntryId,
          snapshotTreeHash: data.snapshotTreeHash,
        });
        if (data.status === "approved") everApproved.add(data.path);
      }
    } catch {}
  }
  rl.close();

  // Compute maxTurnIndexAtLastApproval from timestamps so that out-of-order
  // writes (compaction, CLI restart, async flush) cannot corrupt the value.
  // For each path, find its latest approval timestamp, then pick the highest
  // turnIndex among turns that occurred at or before that timestamp.
  const maxTurnIndexAtLastApproval = new Map<string, number>();
  for (const [path, approval] of approvals) {
    let maxTurn = -1;
    for (const turn of turns) {
      if (turn.timestamp <= approval.timestamp && turn.turnIndex > maxTurn) {
        maxTurn = turn.turnIndex;
      }
    }
    maxTurnIndexAtLastApproval.set(path, maxTurn);
  }

  return { turns, approvals, everApproved, maxTurnIndexAtLastApproval };
}

/**
 * Read pending changes from session JSONL when CLI process is not available.
 * Returns list without oldContent/newContent (process required for diff data).
 */
async function readPendingFromJsonl(sessionPath: string): Promise<PendingChangeResult[]> {
  const { turns, approvals, everApproved, maxTurnIndexAtLastApproval } =
    await readReviewStateFromJsonl(sessionPath);

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

async function readApprovalsFromJsonl(
  sessionPath: string,
  status?: ReviewApprovalStatus,
): Promise<ApprovalResult[]> {
  const { approvals } = await readReviewStateFromJsonl(sessionPath);
  const items = [...approvals.values()]
    .filter((approval) => (status ? approval.status === status : approval.status !== "pending"))
    .map((approval) => ({
      turnIndex: -1,
      path: approval.path,
      status: approval.status,
      timestamp: approval.timestamp,
      snapshotEntryId: approval.snapshotEntryId,
      snapshotTreeHash: approval.snapshotTreeHash,
    }));
  items.sort((a, b) => b.timestamp - a.timestamp || a.path.localeCompare(b.path));
  return items;
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
        // Strip bulk content fields before sending over the wire.
        // Frontend only uses these as a fallback when agent process is gone
        // (see use-git-store.ts); in normal operation the per-file diff is
        // fetched on demand. Including them here balloons the response to
        // 10+ MB on sessions with many file changes (binary assets become
        // base64 strings), which fills the WS buffer and stalls pagination.
        const stripped = items.map((it: unknown) => {
          const i = it as {
            oldContent?: unknown;
            newContent?: unknown;
            unifiedDiff?: unknown;
            [key: string]: unknown;
          };
          const { oldContent: _o, newContent: _n, unifiedDiff: _d, ...rest } = i;
          return rest;
        });
        return stripped as unknown as R<"change-review.pending">;
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
      // Same strip as above
      const stripped = items.map((it) => {
        const { oldContent: _o, newContent: _n, unifiedDiff: _d, ...rest } = it;
        return rest;
      });
      return stripped as unknown as R<"change-review.pending">;
    } catch (err) {
      log.warn("review.pending JSONL read failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  });

  r("change-review.approvals", async (params) => {
    const manager = getProcessManager();

    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result: unknown = await withTimeout(
          manager.callChannel(params.sessionId, "file-review", FILE_REVIEW_METHODS.APPROVALS, {
            status: params.status,
          }),
          CHANNEL_TIMEOUT_MS,
        );
        const items = Array.isArray(result)
          ? result
          : Array.isArray((result as Record<string, unknown>)?.result)
            ? ((result as Record<string, unknown>).result as unknown[])
            : [];
        return items as unknown as R<"change-review.approvals">;
      } catch (err: unknown) {
        log.warn("review.approvals channel call failed, falling back to JSONL", {
          sessionId: params.sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!params.sessionPath) return [];
    try {
      const items = await readApprovalsFromJsonl(params.sessionPath, params.status);
      return items as unknown as R<"change-review.approvals">;
    } catch (err) {
      log.warn("review.approvals JSONL read failed", {
        sessionId: params.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  });

  r("change-review.approve", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false, error: "Session not active" };
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
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  r("change-review.reject", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false, error: "Session not active" };
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
