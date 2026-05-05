import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";

const log = createLogger("snapshot");

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

interface SnapshotMeta {
  id: string;
  sessionId: string;
  timestamp: number;
  description: string;
  messageIndex: number;
  parentSnapshotId: string | null;
  files: string[];
  rolledBack: boolean;
}

const SNAPSHOTS_FILE = ".snapshots.json";

async function readSnapshots(sessionDir: string): Promise<SnapshotMeta[]> {
  const filePath = join(sessionDir, SNAPSHOTS_FILE);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as SnapshotMeta[];
}

async function writeSnapshots(sessionDir: string, snapshots: SnapshotMeta[]): Promise<void> {
  const filePath = join(sessionDir, SNAPSHOTS_FILE);
  await writeFile(filePath, JSON.stringify(snapshots, null, 2), "utf-8");
}

function resolveSessionDir(sessionId: string): string | null {
  const manager = getProcessManager();
  if (!manager) return null;
  const projectPath = manager.getProjectPath(sessionId);
  if (!projectPath) return null;
  return join(projectPath, ".pi", "sessions", sessionId);
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("snapshot.list", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.list",
          {
            sessionId: params.sessionId,
          },
        );
        if (Array.isArray(result)) return result as unknown as R<"snapshot.list">;
      } catch (err) {
        log.warn("snapshot.list channel call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dir = resolveSessionDir(params.sessionId);
    if (!dir || !existsSync(dir)) return [] as unknown as R<"snapshot.list">;
    const snapshots = await readSnapshots(dir);
    return snapshots as unknown as R<"snapshot.list">;
  });

  r("snapshot.get", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.get",
          {
            sessionId: params.sessionId,
            snapshotId: params.snapshotId,
          },
        );
        if (result) return result as unknown as R<"snapshot.get">;
      } catch (err) {
        log.warn("snapshot.get channel call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dir = resolveSessionDir(params.sessionId);
    if (!dir || !existsSync(dir)) return null;
    const snapshots = await readSnapshots(dir);
    return (snapshots.find((s) => s.id === params.snapshotId) ??
      null) as unknown as R<"snapshot.get">;
  });

  r("snapshot.rollback", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
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
        )) as { ok: boolean; restoredFiles: string[]; error?: string };
        if (result) return result as R<"snapshot.rollback">;
      } catch (err) {
        log.warn("snapshot.rollback channel call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dir = resolveSessionDir(params.sessionId);
    if (!dir || !existsSync(dir))
      return { ok: false, restoredFiles: [], error: "Session not found" };

    const snapshots = await readSnapshots(dir);
    const snapshot = snapshots.find((s) => s.id === params.snapshotId);
    if (!snapshot) return { ok: false, restoredFiles: [], error: "Snapshot not found" };

    const restoredFiles = params.files
      ? snapshot.files.filter((f) => (params.files as string[]).includes(f))
      : [...snapshot.files];

    const updated = snapshots.map((s) =>
      s.id === params.snapshotId ? { ...s, rolledBack: true } : s,
    );
    await writeSnapshots(dir, updated);

    return { ok: true, restoredFiles };
  });

  r("snapshot.unrevert", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = (await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.unrevert",
          {
            sessionId: params.sessionId,
            snapshotId: params.snapshotId,
          },
        )) as { ok: boolean; error?: string };
        if (result) return result as R<"snapshot.unrevert">;
      } catch (err) {
        log.warn("snapshot.unrevert channel call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dir = resolveSessionDir(params.sessionId);
    if (!dir || !existsSync(dir)) return { ok: false, error: "Session not found" };

    const snapshots = await readSnapshots(dir);
    const snapshot = snapshots.find((s) => s.id === params.snapshotId);
    if (!snapshot) return { ok: false, error: "Snapshot not found" };
    if (!snapshot.rolledBack) return { ok: false, error: "Snapshot is not rolled back" };

    const updated = snapshots.map((s) =>
      s.id === params.snapshotId ? { ...s, rolledBack: false } : s,
    );
    await writeSnapshots(dir, updated);

    return { ok: true };
  });

  r("snapshot.navigate_tree", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = (await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.navigateTree",
          {
            sessionId: params.sessionId,
            snapshotId: params.snapshotId,
            path: params.path,
          },
        )) as {
          entries: Array<{
            name: string;
            path: string;
            type: "file" | "directory";
            contentHash?: string;
          }>;
          currentPath: string;
        };
        if (result) return result as R<"snapshot.navigate_tree">;
      } catch (err) {
        log.warn("snapshot.navigate_tree channel call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dir = resolveSessionDir(params.sessionId);
    if (!dir || !existsSync(dir)) return { entries: [], currentPath: params.path ?? "/" };

    const snapshots = await readSnapshots(dir);
    const snapshot = params.snapshotId
      ? snapshots.find((s) => s.id === params.snapshotId)
      : snapshots[0];
    if (!snapshot) return { entries: [], currentPath: params.path ?? "/" };

    const entries = snapshot.files.map((f) => {
      const parts = f.split("/");
      return {
        name: parts[parts.length - 1],
        path: f,
        type: "file" as const,
        contentHash: `${snapshot.id}:${f}`,
      };
    });

    return { entries, currentPath: params.path ?? "/" };
  });

  r("snapshot.get_tree", async (params) => {
    const manager = getProcessManager();
    if (manager && manager.hasSession(params.sessionId)) {
      try {
        const result = await manager.callChannel(
          params.sessionId,
          "file-snapshot",
          "snapshot.getTree",
          {
            sessionId: params.sessionId,
            snapshotId: params.snapshotId,
            filePath: params.filePath,
          },
        );
        if (result !== undefined) return result as R<"snapshot.get_tree">;
      } catch (err) {
        log.warn("snapshot.get_tree channel call failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const dir = resolveSessionDir(params.sessionId);
    if (!dir || !existsSync(dir)) return null;

    const snapshots = await readSnapshots(dir);
    const snapshot = snapshots.find((s) => s.id === params.snapshotId);
    if (!snapshot) return null;
    if (!snapshot.files.includes(params.filePath)) return null;

    return {
      path: params.filePath,
      content: `content of ${params.filePath} at ${params.snapshotId}`,
      contentHash: `${snapshot.id}:${params.filePath}`,
    };
  });
}
