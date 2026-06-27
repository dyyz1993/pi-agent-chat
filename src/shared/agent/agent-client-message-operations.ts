import { performance } from "perf_hooks";

import type { AgentMessageForUI } from "../modules/agent";
import { createLogger } from "../lib/logger";
import {
  appendUiJsonlEntriesFromPath,
  filterMessagesToBranch,
  paginateEntryMessages,
  readFullJsonlAccumulatorCached,
  type UiCustomEntry,
} from "./session-jsonl-messages";
import type { SessionCacheData, SessionCacheHit } from "./session-message-cache";

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

function normalizedMessageSignature(message: Record<string, unknown>): string {
  const role = typeof message.role === "string" ? message.role : "";
  const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
  const toolName = typeof message.toolName === "string" ? message.toolName : "";
  const content = Array.isArray(message.content) ? message.content : [];
  let textHash = 0;
  for (const block of content) {
    if (!block) continue;
    if (typeof block === "string") {
      for (let i = 0; i < block.length; i++) {
        textHash = ((textHash << 5) - textHash + block.charCodeAt(i)) | 0;
      }
      continue;
    }
    if (typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    const text = typeof b.text === "string" ? b.text : "";
    for (let i = 0; i < text.length; i++) {
      textHash = ((textHash << 5) - textHash + text.charCodeAt(i)) | 0;
    }
    const thinking = typeof b.thinking === "string" ? b.thinking : "";
    for (let i = 0; i < thinking.length; i++) {
      textHash = ((textHash << 5) - textHash + thinking.charCodeAt(i)) | 0;
    }
  }
  return `${role}:${toolCallId}:${toolName}:${content.length}:${textHash}`;
}

function parseObjectish(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizedToolName(name: unknown): string {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

function normalizedToolText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function getToolCallMatchKeys(block: Record<string, unknown>): string[] {
  const id = typeof block.id === "string" ? block.id : "";
  const name = normalizedToolName(block.name);
  const rawInput = block.input ?? block.arguments;
  const inputObj = parseObjectish(rawInput);
  const description = normalizedToolText(inputObj?.description);
  const command = normalizedToolText(inputObj?.command);

  const keys: string[] = [];
  if (id) keys.push(`id:${id}`);
  if (name && description) keys.push(`desc:${name}:${description}`);
  if (name && command) keys.push(`command:${name}:${command}`);
  return keys;
}

function extractToolCallBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter((block): block is Record<string, unknown> => {
    return (
      !!block && typeof block === "object" && (block as Record<string, unknown>).type === "toolCall"
    );
  });
}

function completedToolCallKeysFromMessages(messages: Array<{ message: unknown }>): Set<string> {
  const assistantToolKeysById = new Map<string, string[]>();
  const completedKeys = new Set<string>();

  for (const entry of messages) {
    const message =
      entry.message && typeof entry.message === "object"
        ? (entry.message as Record<string, unknown>)
        : null;
    if (!message) continue;

    if (message.role === "assistant") {
      for (const block of extractToolCallBlocks(message)) {
        const id = typeof block.id === "string" ? block.id : "";
        if (id) assistantToolKeysById.set(id, getToolCallMatchKeys(block));
      }
      continue;
    }

    if (message.role === "toolResult") {
      const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
      if (!toolCallId) continue;
      completedKeys.add(`id:${toolCallId}`);
      for (const key of assistantToolKeysById.get(toolCallId) ?? []) {
        completedKeys.add(key);
      }
    }
  }

  return completedKeys;
}

function isCompletedToolCallMessage(
  message: Record<string, unknown>,
  completedToolCallKeys: Set<string>,
): boolean {
  if (message.role !== "assistant") return false;
  const toolCalls = extractToolCallBlocks(message);
  if (toolCalls.length === 0) return false;
  return toolCalls.every((block) => {
    const keys = getToolCallMatchKeys(block);
    return keys.length > 0 && keys.some((key) => completedToolCallKeys.has(key));
  });
}

export async function getFullMessagesOperation<TManaged extends ManagedFullMessagesLike>(options: {
  sessionId: string;
  sessionPath?: string;
  pagination?: { limit?: number; afterEntryId?: string };
  getActiveManaged: (sessionId: string) => TManaged | null;
  resolveSessionPath: (sessionId: string) => string;
  leafIds: Map<string, string | null>;
  readSandboxFile?: (pathToRead: string) => Promise<string>;
  getSessionCache?: (sessionId: string, sessionPath: string) => SessionCacheHit | null;
  setSessionCache?: (sessionId: string, sessionPath: string, data: SessionCacheData) => void;
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

  const accumulator = await readFullJsonlAccumulatorCached({
    sessionId: options.sessionId,
    sessionPath: resolvedSessionPath,
    readSandboxFile: options.readSandboxFile,
    getCache: options.getSessionCache,
    setCache: options.setSessionCache,
  });

  const jsonlLeafId = accumulator.lastJsonlLeafPointer
    ? (accumulator.activeJsonlLeafId ?? accumulator.lastJsonlLeafPointer)
    : null;
  // During streaming, in-memory leafIds is stale (only updated on agent_end/navigateTree).
  // The new user message is a CHILD of the stale leaf and gets excluded by branch filter.
  // Use the last JSONL entry instead — it always includes the latest messages.
  const isStreaming = managed?.info.status === "streaming";
  const leafId =
    jsonlLeafId ??
    (isStreaming ? (accumulator.activeJsonlLeafId ?? null) : null) ??
    options.leafIds.get(options.sessionId) ??
    null;
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

  let totalCount = filteredMessages.length;
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

  const useCliMemoryAsPrimarySource = accumulator.allMessages.length === 0;
  const shouldMergeCliMemory =
    !!managed && (managed.info.status === "streaming" || useCliMemoryAsPrimarySource);
  if (managed && shouldMergeCliMemory) {
    try {
      const memResult = await withTimeout(
        managed.client.getMessages(),
        5_000,
        "getMessages (CLI memory merge)",
      );
      if (Array.isArray(memResult) && memResult.length > 0) {
        const jsonlEntryIds = new Set(
          accumulator.allMessages.map((m) => m.entryId).filter(Boolean),
        );
        const jsonlMessageSignatures = new Set(
          accumulator.allMessages
            .map((m) => {
              const msg = m.message as Record<string, unknown> | undefined;
              return msg ? normalizedMessageSignature(msg) : "";
            })
            .filter(Boolean),
        );
        const jsonlUserTexts = new Set(
          accumulator.allMessages
            .filter((m) => {
              const msg = m.message as Record<string, unknown> | undefined;
              return msg && (msg.role as string) === "user";
            })
            .map((m) => messageText(m.message as Record<string, unknown>))
            .filter(Boolean),
        );
        const completedToolCallKeys = completedToolCallKeysFromMessages(filteredMessages);
        const compactionEntryIds = new Set(accumulator.allCompactionEntries.map((c) => c.entryId));
        const filteredHasCompaction = filteredMessages.some((fm) => {
          const fmMsg = fm.message as Record<string, unknown>;
          return fmMsg && (fmMsg.role as string) === "compactionSummary";
        });
        let addedFromMemory = 0;
        for (const msg of memResult) {
          const m = msg as Record<string, unknown>;
          const eid = (m.entryId as string) ?? "";
          const role = (m.role as string) ?? "";
          if (eid && jsonlEntryIds.has(eid)) continue;
          if (!eid && jsonlMessageSignatures.has(normalizedMessageSignature(m))) continue;
          if (!eid && isCompletedToolCallMessage(m, completedToolCallKeys)) continue;
          if (role === "compactionSummary") {
            if (eid && compactionEntryIds.has(eid)) continue;
            if (!eid && filteredHasCompaction) continue;
          }
          if (role === "user" && !eid) {
            const text = messageText(m);
            if (text && jsonlUserTexts.has(text)) continue;
          }
          slicedMessages.push(m as unknown as AgentMessageForUI);
          addedFromMemory++;
          if (eid) jsonlEntryIds.add(eid);
          jsonlMessageSignatures.add(normalizedMessageSignature(m));
        }
        if (useCliMemoryAsPrimarySource) {
          totalCount = Math.max(totalCount, slicedMessages.length);
        }
        perfLog.info("[getFullMessages] memory merge: added from CLI memory", {
          sessionId: options.sessionId,
          addedCount: addedFromMemory,
          messageCount: slicedMessages.length,
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
