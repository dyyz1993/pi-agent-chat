import { performance } from "perf_hooks";

import type { AgentMessageForUI } from "../modules/agent";
import { createLogger } from "../lib/logger";
import {
  appendUiJsonlEntriesFromPath,
  filterMessagesToBranch,
  paginateEntryMessages,
  readFullJsonlAccumulator,
  type UiCustomEntry,
} from "./session-jsonl-messages";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

interface ManagedFullMessagesLike {
  client: {
    getMessages(): Promise<unknown[]>;
    getTreeWithLeaf(): Promise<{
      entries: Array<{ id: string; parentId: string | null; type: string; label?: string }>;
      leafId: string | null;
    }>;
  };
  info: {
    status: string;
    sessionPath: string;
  };
}

interface JsonlMessageTreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
}

function buildActivePathIds(
  entries: Array<{ id: string; parentId: string | null }>,
  leafId: string | null,
): Set<string> | null {
  if (!leafId || entries.length === 0) return null;
  const byId = new Map<string, { id: string; parentId: string | null }>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  const activePathIds = new Set<string>();
  let curId: string | null | undefined = leafId;
  while (curId) {
    activePathIds.add(curId);
    const node = byId.get(curId);
    curId = node && typeof node.parentId === "string" && node.parentId ? node.parentId : undefined;
  }
  return activePathIds;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

function messageText(message: Record<string, unknown>): string {
  const content = message.content as unknown[];
  if (!Array.isArray(content)) return "";
  return content
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .filter((c) => c.type === "text")
    .map((c) => (c.text as string) ?? "")
    .join("");
}

export async function getFullMessagesOperation<TManaged extends ManagedFullMessagesLike>(options: {
  sessionId: string;
  sessionPath?: string;
  pagination?: { limit?: number; afterEntryId?: string };
  getActiveManaged: (sessionId: string) => TManaged | null;
  resolveSessionPath: (sessionId: string) => string;
  leafIds: Map<string, string | null>;
  readSandboxFile?: (pathToRead: string) => Promise<string>;
}): Promise<{
  messages: AgentMessageForUI[];
  customEntries: UiCustomEntry[];
  hasMore: boolean;
  totalCount: number;
  nextCursor: string | null;
}> {
  const t0 = performance.now();
  const managed = options.getActiveManaged(options.sessionId);
  const cachedSessionPath = options.resolveSessionPath(options.sessionId);
  const resolvedSessionPath = managed
    ? managed.info.sessionPath
    : cachedSessionPath
      ? cachedSessionPath
      : (options.sessionPath ?? "");

  const accumulator = await readFullJsonlAccumulator({
    sessionPath: resolvedSessionPath,
    readSandboxFile: options.readSandboxFile,
  });

  const jsonlLeafId = accumulator.lastJsonlLeafPointer
    ? (accumulator.activeJsonlLeafId ?? accumulator.lastJsonlLeafPointer)
    : null;
  const leafId = jsonlLeafId ?? options.leafIds.get(options.sessionId) ?? null;
  if (leafId && leafId !== options.leafIds.get(options.sessionId)) {
    options.leafIds.set(options.sessionId, leafId);
  }

  const { filteredMessages, customEntries, leafFound } = filterMessagesToBranch({
    allMessages: accumulator.allMessages,
    allCustomEntries: accumulator.allCustomEntries,
    parentById: accumulator.parentById,
    leafId,
  });
  if (!leafFound && leafId) {
    log.warn("[getFullMessages] leafId not found in JSONL, skipping branch filter", {
      sessionId: options.sessionId,
      leafId,
      totalEntries: accumulator.parentById.size,
    });
  }

  const totalCount = filteredMessages.length;
  const limit = options.pagination?.limit;
  const afterEntryId = options.pagination?.afterEntryId;
  const cursorMissing =
    afterEntryId != null && !filteredMessages.some((entry) => entry.entryId === afterEntryId);
  if (cursorMissing) {
    log.warn("[getFullMessages] afterEntryId not found, returning empty page", {
      sessionId: options.sessionId,
      afterEntryId,
      totalCount,
    });
  }
  const { slicedMessages, hasMore, nextCursor } = paginateEntryMessages({
    filteredMessages,
    limit,
    afterEntryId,
  });

  const totalMs = Math.round(performance.now() - t0);

  if (managed && managed.info.status === "streaming") {
    try {
      const memResult = await withTimeout(
        managed.client.getMessages(),
        5_000,
        "getMessages (streaming merge)",
      );
      if (Array.isArray(memResult) && memResult.length > 0) {
        const jsonlEntryIds = new Set(accumulator.allMessages.map((m) => m.entryId).filter(Boolean));
        const jsonlUserTexts = new Set(
          accumulator.allMessages
            .filter((m) => {
              const msg = m.message as Record<string, unknown> | undefined;
              return msg && (msg.role as string) === "user";
            })
            .map((m) => messageText(m.message as Record<string, unknown>))
            .filter(Boolean),
        );
        const compactionEntryIds = new Set(accumulator.allCompactionEntries.map((c) => c.entryId));
        const filteredHasCompaction = filteredMessages.some((fm) => {
          const fmMsg = fm.message as Record<string, unknown>;
          return fmMsg && (fmMsg.role as string) === "compactionSummary";
        });
        for (const msg of memResult) {
          const m = msg as Record<string, unknown>;
          const eid = (m.entryId as string) ?? "";
          const role = (m.role as string) ?? "";
          if (eid && jsonlEntryIds.has(eid)) continue;
          if (role === "compactionSummary") {
            if (eid && compactionEntryIds.has(eid)) continue;
            if (!eid && filteredHasCompaction) continue;
          }
          if (role === "user" && !eid) {
            const text = messageText(m);
            if (text && jsonlUserTexts.has(text)) continue;
          }
          slicedMessages.push(m as unknown as AgentMessageForUI);
          if (eid) jsonlEntryIds.add(eid);
        }
        perfLog.info("[getFullMessages] streaming merge: added from CLI memory", {
          sessionId: options.sessionId,
          mergedCount: slicedMessages.length,
        });
      }
    } catch (err: unknown) {
      log.debug("[getMessages] CLI memory merge skipped", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  perfLog.info("[getFullMessages] done", {
    sessionId: options.sessionId,
    messageCount: slicedMessages.length,
    totalCount,
    hasMore,
    leafId: leafId ?? "none",
    totalMs,
  });

  return {
    messages: slicedMessages as AgentMessageForUI[],
    customEntries,
    hasMore,
    totalCount,
    nextCursor,
  };
}

export async function getMessagesOperation<TManaged extends ManagedFullMessagesLike>(options: {
  sessionId: string;
  sessionPath?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  resolveSessionPath: (sessionId: string) => string;
  readJsonlEntries: (sessionPath: string) => Promise<JsonlMessageTreeEntry[]>;
  buildMessagesFromJsonl: (
    entries: Array<{ id: string; parentId: string | null; type: string }>,
    leafId: string | null,
  ) => unknown[];
  leafIds: Map<string, string | null>;
  readSandboxFile?: (pathToRead: string) => Promise<string>;
}): Promise<{
  messages: AgentMessageForUI[];
  customEntries: UiCustomEntry[];
}> {
  const managed = options.getActiveManaged(options.sessionId);
  let messages: unknown[] = [];
  let resolvedSessionPath = options.sessionPath ?? "";
  let activePathIds: Set<string> | null = null;

  if (managed) {
    resolvedSessionPath = managed.info.sessionPath;
    try {
      const messagesResult = await withTimeout(managed.client.getMessages(), 15_000, "getMessages");
      if (messagesResult) messages = messagesResult;
    } catch (err: unknown) {
      log.warn("getMessages SDK failed", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      const treeResult = await withTimeout(
        managed.client.getTreeWithLeaf(),
        10_000,
        "getTreeWithLeaf",
      );
      if (treeResult.leafId) options.leafIds.set(options.sessionId, treeResult.leafId);
      activePathIds = buildActivePathIds(treeResult.entries, treeResult.leafId);
    } catch (err: unknown) {
      log.warn("getTreeWithLeaf failed in getMessages", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    const cachedSessionPath = options.resolveSessionPath(options.sessionId);
    resolvedSessionPath = cachedSessionPath ? cachedSessionPath : (options.sessionPath ?? "");
    const leafId = options.leafIds.get(options.sessionId) ?? null;
    if (resolvedSessionPath && leafId !== undefined) {
      const jsonlEntries = await options.readJsonlEntries(resolvedSessionPath);
      if (jsonlEntries.length > 0 && leafId !== null) {
        activePathIds = buildActivePathIds(jsonlEntries, leafId);
      }
      messages = options.buildMessagesFromJsonl(jsonlEntries, leafId);
    }
  }

  const customEntries: UiCustomEntry[] = [];
  await appendUiJsonlEntriesFromPath({
    sessionPath: resolvedSessionPath,
    messages,
    customEntries,
    activePathIds,
    includeMessages: !managed,
    readSandboxFile: !managed ? options.readSandboxFile : undefined,
  });

  return { messages: messages as AgentMessageForUI[], customEntries };
}
