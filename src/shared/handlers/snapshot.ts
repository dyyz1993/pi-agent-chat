import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { createLogger } from "../lib/logger";
import { getProcessManager } from "./agent";
import { findSessionById } from "../lib/session-scanner";
import type { SnapshotInfo } from "../../mainview/types";

const log = createLogger("snapshot");

interface StepSnapshotEntry {
  type: "custom";
  customType: "step-snapshot";
  data: {
    baselineTreeHash: string | null;
    snapshotTreeHash: string;
    diff: { added: string[]; modified: string[]; deleted: string[] } | null;
    turnIndex: number;
  };
  id: string;
  parentId: string;
  timestamp: string;
}

interface UnrevertPointEntry {
  type: "custom";
  customType: "unrevert-point";
  data: {
    preRollbackTreeHash: string | null;
    rolledBackToLeaf: string;
    restoredFiles: string[];
  };
  id: string;
  parentId: string;
  timestamp: string;
}

async function readStepSnapshots(sessionPath: string): Promise<StepSnapshotEntry[]> {
  const snapshots: StepSnapshotEntry[] = [];
  try {
    const rl = createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "custom" && entry.customType === "step-snapshot") {
          snapshots.push(entry as unknown as StepSnapshotEntry);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch (err) {
    log.warn("failed to read step-snapshots from JSONL", {
      sessionPath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return snapshots;
}

async function readUnrevertPoints(sessionPath: string): Promise<UnrevertPointEntry[]> {
  const points: UnrevertPointEntry[] = [];
  try {
    const rl = createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "custom" && entry.customType === "unrevert-point") {
          points.push(entry as unknown as UnrevertPointEntry);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // ignore read errors
  }
  return points;
}

function toSnapshotInfo(snap: StepSnapshotEntry, rolledBack: boolean): SnapshotInfo {
  const diff = snap.data.diff ?? { added: [], modified: [], deleted: [] };
  const files: Record<string, string> = {};
  for (const f of diff.added) files[f] = "added";
  for (const f of diff.modified) files[f] = "modified";
  for (const f of diff.deleted) files[f] = "deleted";

  return {
    id: snap.id,
    stepIndex: snap.data.turnIndex,
    timestamp: snap.timestamp,
    treeHash: snap.data.snapshotTreeHash,
    diff,
    files,
    rolledBack,
  };
}

async function getSessionPath(sessionId: string): Promise<string | null> {
  const manager = getProcessManager();
  if (manager) {
    const path = manager.getSessionPath(sessionId);
    if (path) return path;
  }

  // Fallback: scan sessions directory to find the JSONL file
  const meta = await findSessionById(sessionId);
  return meta?.sessionPath ?? null;
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("snapshot.list", async (params) => {
    const manager = getProcessManager();

    // If session is live, try channel first
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.list",
          { sessionId: params.sessionId },
        );
        if (Array.isArray(result)) return result as unknown as R<"snapshot.list">;
      } catch (err) {
        log.warn("snapshot.list channel call failed, falling back to JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: read step-snapshot entries from JSONL
    const sessionPath = await getSessionPath(params.sessionId);
    if (!sessionPath) return [] as unknown as R<"snapshot.list">;

    const snapshots = await readStepSnapshots(sessionPath);
    const unrevertPoints = await readUnrevertPoints(sessionPath);

    // Determine which snapshots have been rolled back
    const rolledBackIds = new Set(unrevertPoints.map((p) => p.data.rolledBackToLeaf));

    return snapshots
      .filter((s) => s.data.diff !== null)
      .map((s) => toSnapshotInfo(s, rolledBackIds.has(s.id))) as unknown as R<"snapshot.list">;
  });

  r("snapshot.get", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.get",
          { sessionId: params.sessionId, snapshotId: params.snapshotId },
        );
        if (result) return result as unknown as R<"snapshot.get">;
      } catch (err) {
        log.warn("snapshot.get channel call failed, falling back to JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const sessionPath = await getSessionPath(params.sessionId);
    if (!sessionPath) return null;

    const snapshots = await readStepSnapshots(sessionPath);
    const snap = snapshots.find((s) => s.id === params.snapshotId);
    if (!snap) return null;

    return toSnapshotInfo(snap, false) as unknown as R<"snapshot.get">;
  });

  r("snapshot.rollback", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false, restoredFiles: [], error: "Session not found" };
    }

    // Try channel first (full restore via FileSnapshotManager)
    try {
      const result = (await manager.callChannel(
        params.sessionId,
        "file-snapshot",
        "snapshot.rollback",
        {
          sessionId: params.sessionId,
          snapshotId: params.snapshotId,
          files: params.files,
        },
      )) as { ok: boolean; restoredFiles: string[]; error?: string } | null;
      if (result) return result as R<"snapshot.rollback">;
    } catch (err) {
      log.warn("snapshot.rollback channel failed, using navigateTree fallback", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Fallback: use navigateTree to restore files
    // The file-snapshot extension listens on session_tree events and restores files
    try {
      await manager.navigateTree(params.sessionId, params.snapshotId, { skipFiles: false });
      return { ok: true, restoredFiles: [] };
    } catch (err) {
      log.error("snapshot.rollback navigateTree fallback failed", {
        sessionId: params.sessionId,
        snapshotId: params.snapshotId,
        err: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        restoredFiles: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  r("snapshot.unrevert", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return { ok: false, error: "Session not found" };
    }

    // Try channel first
    try {
      const result = (await manager.callChannel(
        params.sessionId,
        "file-snapshot",
        "snapshot.unrevert",
        {
          sessionId: params.sessionId,
          snapshotId: params.snapshotId,
        },
      )) as { ok: boolean; error?: string } | null;
      if (result) return result as R<"snapshot.unrevert">;
    } catch (err) {
      log.warn("snapshot.unrevert channel failed, using JSONL fallback", {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Fallback: find the unrevert-point entry and navigate back
    const sessionPath = await getSessionPath(params.sessionId);
    if (!sessionPath) return { ok: false, error: "Session path not found" };

    const unrevertPoints = await readUnrevertPoints(sessionPath);
    const point = unrevertPoints.find((p) => p.data.rolledBackToLeaf === params.snapshotId);
    if (!point) {
      return { ok: false, error: "Unrevert point not found" };
    }

    // The unrevert-point contains preRollbackTreeHash, but we need a target leaf ID
    // to navigate back. Since we can't directly use tree hash, we use the entry's parentId
    // as a proxy — navigate to the entry just before the rollback happened.
    try {
      await manager.navigateTree(params.sessionId, point.parentId, { skipFiles: false });
      return { ok: true };
    } catch (err) {
      log.error("snapshot.unrevert navigateTree fallback failed", {
        sessionId: params.sessionId,
        snapshotId: params.snapshotId,
        err: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  r("snapshot.navigateTree", async (params) => {
    const manager = getProcessManager();

    // If we have a live session, use getBatchDiffs for real file entries
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = await manager.getBatchDiffs(params.sessionId);
        const entries = result.files.map((f) => ({
          name: f.path.split("/").pop() ?? f.path,
          path: f.path,
          type: "file" as const,
          contentHash: `${f.status}:${f.path}`,
        }));
        return { entries, currentPath: params.path ?? "/" } as R<"snapshot.navigateTree">;
      } catch (err) {
        log.warn("snapshot.navigateTree getBatchDiffs failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fallback: read snapshots from JSONL
    const sessionPath = await getSessionPath(params.sessionId);
    if (!sessionPath) return { entries: [], currentPath: params.path ?? "/" };

    const snapshots = await readStepSnapshots(sessionPath);
    const target = params.snapshotId
      ? snapshots.find((s) => s.id === params.snapshotId)
      : snapshots[snapshots.length - 1];
    if (!target || !target.data.diff) {
      return { entries: [], currentPath: params.path ?? "/" };
    }

    const diff = target.data.diff;
    const allPaths = [...diff.added, ...diff.modified, ...diff.deleted];
    const entries = allPaths.map((f) => ({
      name: f.split("/").pop() ?? f,
      path: f,
      type: "file" as const,
      contentHash: `${target.id}:${f}`,
    }));

    return { entries, currentPath: params.path ?? "/" };
  });

  r("snapshot.getTree", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const diffs = await manager.getBatchDiffs(params.sessionId);
        const file = diffs.files.find((f) => f.path === params.filePath);
        if (file?.diff) {
          return {
            path: file.diff.path,
            content: file.diff.newContent ?? file.diff.oldContent ?? "",
            contentHash: `${file.status}:${file.path}`,
          } as R<"snapshot.getTree">;
        }
      } catch (err) {
        log.warn("snapshot.getTree getBatchDiffs failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return null;
  });
}
