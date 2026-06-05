import { existsSync } from "fs";
import { createReadStream } from "fs";
import { appendFile } from "node:fs/promises";
import * as readline from "readline";

import { createLogger } from "../lib/logger";
import type { TreeEntry } from "../modules/agent";
import {
  createLeafPointerEntry,
  mapJsonlEntriesToTreeEntries,
  parseJsonlTreeEntry,
  resolveFallbackBranchPoint,
  type JsonlTreeEntry,
} from "./session-tree-navigation";

const log = createLogger("agent");

interface NavigateManagedClient {
  info: {
    status: string;
  };
  client: {
    navigateTree: (
      targetId: string,
      options?: { summarize?: boolean; skipFiles?: boolean },
    ) => Promise<{ cancelled: boolean; reason?: string }>;
  };
}

interface TreeManagedClient {
  client: {
    getTreeWithLeaf: () => Promise<{ entries?: unknown[]; leafId?: string | null }>;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

export async function readJsonlTreeEntriesOperation(
  sessionPath: string,
): Promise<JsonlTreeEntry[]> {
  const entries: JsonlTreeEntry[] = [];
  if (!sessionPath || !existsSync(sessionPath)) return entries;
  try {
    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const entry = parseJsonlTreeEntry(parsed);
        if (entry) entries.push(entry);
      } catch (err: unknown) {
        log.warn("readJsonlEntries: skipping malformed entry", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    rl.close();
  } catch (err: unknown) {
    log.warn("readJsonlEntries: failed to read file", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return entries;
}

export async function navigateTreeOperation<TManaged extends NavigateManagedClient>(options: {
  sessionId: string;
  targetId: string;
  navigateOptions?: { summarize?: boolean; skipFiles?: boolean };
  getActiveManaged: (sessionId: string) => TManaged | null;
  resolveSessionPath: (sessionId: string) => string;
  leafIds: Map<string, string | null>;
  readJsonlEntries?: (sessionPath: string) => Promise<JsonlTreeEntry[]>;
}): Promise<{ cancelled: boolean; reason?: string }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (managed) {
    if (managed.info.status === "streaming") {
      log.warn("navigateTree: blocked — agent is streaming", {
        sessionId: options.sessionId,
        targetId: options.targetId,
      });
      return { cancelled: true, reason: "Agent is streaming" };
    }
    const result = await withTimeout(
      managed.client.navigateTree(options.targetId, options.navigateOptions),
      30_000,
      "navigateTree",
    );
    if (!result.cancelled) {
      options.leafIds.set(options.sessionId, options.targetId);
      log.info("navigateTree updated leafId", {
        sessionId: options.sessionId,
        targetId: options.targetId,
      });
    }
    return result;
  }

  log.info("navigateTree: no managed client, applying JSONL fallback", {
    sessionId: options.sessionId,
    targetId: options.targetId,
  });

  const sessionPath = options.resolveSessionPath(options.sessionId);
  if (!sessionPath) {
    return { cancelled: true, reason: "No session path found" };
  }

  const readJsonlEntries = options.readJsonlEntries ?? readJsonlTreeEntriesOperation;
  const entries = await readJsonlEntries(sessionPath);
  const { exists, branchPointId } = resolveFallbackBranchPoint(entries, options.targetId);
  if (!exists) {
    return { cancelled: true, reason: "Target entry not found in session" };
  }

  options.leafIds.set(options.sessionId, branchPointId);

  try {
    const leafPointerEntry = createLeafPointerEntry(branchPointId);
    await appendFile(sessionPath, `\n${leafPointerEntry}\n`, "utf-8");
  } catch (leafErr: unknown) {
    log.warn("navigateTree: failed to write leaf_pointer in fallback", {
      sessionId: options.sessionId,
      err: leafErr instanceof Error ? leafErr.message : String(leafErr),
    });
  }

  if (!options.navigateOptions?.skipFiles) {
    log.warn("navigateTree: file restore skipped (no active CLI process)", {
      sessionId: options.sessionId,
      targetId: options.targetId,
    });
  }

  log.info("navigateTree: JSONL fallback applied", {
    sessionId: options.sessionId,
    targetId: options.targetId,
  });
  return { cancelled: false };
}

export async function getTreeOperation<TManaged extends TreeManagedClient>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  resolveSessionPath: (sessionId: string) => string;
  leafIds: Map<string, string | null>;
  readJsonlEntries?: (sessionPath: string) => Promise<JsonlTreeEntry[]>;
}): Promise<{ entries: TreeEntry[]; leafId: string | null | undefined }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (managed) {
    try {
      const result = await withTimeout(managed.client.getTreeWithLeaf(), 15_000, "getTree");
      return {
        entries: Array.isArray(result.entries) ? (result.entries as TreeEntry[]) : [],
        leafId: result.leafId,
      };
    } catch (err: unknown) {
      log.warn("getTree SDK failed, falling back to JSONL", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sessionPath = options.resolveSessionPath(options.sessionId);
  if (!sessionPath) throw new Error("Client not found and no session path");
  const readJsonlEntries = options.readJsonlEntries ?? readJsonlTreeEntriesOperation;
  const entries = await readJsonlEntries(sessionPath);
  return {
    entries: mapJsonlEntriesToTreeEntries(entries),
    leafId: options.leafIds.get(options.sessionId) ?? null,
  };
}
