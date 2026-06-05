import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { createLogger } from "../lib/logger";
import { stripParentSessionFromHeader } from "./coordinator-delegate-utils";

const log = createLogger("agent");

interface ManagedClientLike {
  client: Pick<
    RpcClientAPI,
    | "getLastAssistantText"
    | "getForkMessages"
    | "fork"
    | "previewRollback"
    | "getModifiedFiles"
    | "getFileDiff"
    | "getBatchDiffs"
    | "channel"
    | "clone"
    | "newSession"
    | "exportHtml"
  >;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function getLastAssistantTextOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ text: string | null }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { text: null };
  try {
    const result = await withTimeout(
      managed.client.getLastAssistantText(),
      10_000,
      "getLastAssistantText",
    );
    return { text: result };
  } catch (err: unknown) {
    log.warn("getLastAssistantText error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { text: null };
  }
}

export async function getForkMessagesOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ messages: Array<{ entryId: string; text: string }> }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { messages: [] };
  try {
    const result = await withTimeout(managed.client.getForkMessages(), 10_000, "getForkMessages");
    return { messages: Array.isArray(result) ? result : [] };
  } catch (err: unknown) {
    log.warn("getForkMessages error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { messages: [] };
  }
}

export async function forkOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  entryId: string;
  forkOptions?: { position?: "before" | "at" };
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  text: string;
  cancelled: boolean;
  newSessionFile?: string;
  newSessionId?: string;
}> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) throw new Error("Client not found");
  const result = (await withTimeout(
    managed.client.fork(options.entryId, options.forkOptions),
    60_000,
    "fork",
  )) as {
    text: string;
    cancelled: boolean;
    newSessionFile?: string;
    newSessionId?: string;
  };
  if (result.newSessionFile && !result.cancelled) {
    stripParentSessionFromHeader(result.newSessionFile);
  }
  return result;
}

export async function previewRollbackOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  targetId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ restored: string[]; deleted: string[] }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (managed) {
    return withTimeout(
      managed.client.previewRollback(options.targetId),
      15_000,
      "previewRollback",
    );
  }
  return { restored: [], deleted: [] };
}

export async function getModifiedFilesOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  fromEntryId?: string;
  toEntryId?: string;
  toUserMsgEntryId?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    turnIndex: number;
    entryId: string;
  }>;
  resolvedFromEntryId: string | null;
}> {
  const managed = options.getActiveManaged(options.sessionId);
  if (managed) {
    return withTimeout(
      managed.client.getModifiedFiles({
        fromEntryId: options.fromEntryId,
        toEntryId: options.toEntryId,
        ...((options.toUserMsgEntryId ? { toUserMsgEntryId: options.toUserMsgEntryId } : {}) as Record<
          string,
          string
        >),
      }),
      15_000,
      "getModifiedFiles",
    );
  }
  return { files: [], resolvedFromEntryId: null };
}

export async function getFileDiffOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  filePath: string;
  fromEntryId?: string;
  toEntryId?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  path: string;
  oldContent: string | null;
  newContent: string | null;
  unifiedDiff: string;
} | null> {
  const managed = options.getActiveManaged(options.sessionId);
  if (managed) {
    return withTimeout(
      managed.client.getFileDiff({
        filePath: options.filePath,
        fromEntryId: options.fromEntryId,
        toEntryId: options.toEntryId,
      }),
      15_000,
      "getFileDiff",
    );
  }
  return null;
}

export async function getBatchDiffsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  fromEntryId?: string;
  toEntryId?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted";
    diff: {
      path: string;
      oldContent: string | null;
      newContent: string | null;
      unifiedDiff: string;
    } | null;
  }>;
  summary: { totalFiles: number; added: number; modified: number; deleted: number };
}> {
  const managed = options.getActiveManaged(options.sessionId);
  if (managed) {
    return withTimeout(
      managed.client.getBatchDiffs({
        fromEntryId: options.fromEntryId,
        toEntryId: options.toEntryId,
      }),
      30_000,
      "getBatchDiffs",
    );
  }
  return { files: [], summary: { totalFiles: 0, added: 0, modified: 0, deleted: 0 } };
}

export async function restoreFilesFromSnapshotOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  snapshotTreeHash: string;
  files?: string[];
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<string[]> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) throw new Error("Client not found");

  const result = (await managed.client.channel("file-snapshot").call("snapshot.restoreByHash", {
    snapshotTreeHash: options.snapshotTreeHash,
    files: options.files,
  })) as { restored: string[] } | null;

  return result?.restored ?? [];
}

export async function cloneOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ cancelled: boolean }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) throw new Error("Client not found");
  return withTimeout(managed.client.clone(), 60_000, "clone");
}

export async function newSessionOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  parentSession?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ cancelled: boolean }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) throw new Error("Client not found");
  return withTimeout(managed.client.newSession(options.parentSession), 30_000, "newSession");
}

export async function exportHtmlOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  outputPath?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ path: string }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) throw new Error("Client not found");
  return withTimeout(managed.client.exportHtml(options.outputPath), 60_000, "exportHtml");
}
