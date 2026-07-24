import { createReadStream, existsSync, statSync } from "fs";
import * as readline from "readline";

import { createLogger } from "../lib/logger";
import type { SessionCacheData, SessionCacheHit } from "./session-message-cache";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

export interface UiCustomEntry {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
}

export interface EntryMessage {
  entryId: string;
  message: unknown;
}

export interface CompactionEntry {
  entryId: string;
  summary: string;
  tokensBefore?: number;
  timestamp: number;
}

export interface DeletionEntry {
  entryId: string;
  targetIds: string[];
}

export interface FullMessageAccumulator {
  allMessages: EntryMessage[];
  allCustomEntries: UiCustomEntry[];
  allCompactionEntries: CompactionEntry[];
  allDeletionEntries: DeletionEntry[];
  parentById: Map<string, string | null>;
  lastJsonlLeafPointer: string | null;
  activeJsonlLeafId: string | null;
}

export interface BranchFilteredMessages {
  filteredMessages: EntryMessage[];
  customEntries: UiCustomEntry[];
  leafFound: boolean;
}

export interface PaginatedMessages {
  slicedMessages: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AroundEntryMessages {
  slicedMessages: unknown[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  beforeCursor: string | null;
  afterCursor: string | null;
  targetFound: boolean;
}

function createFullMessageAccumulator(): FullMessageAccumulator {
  return {
    allMessages: [],
    allCustomEntries: [],
    allCompactionEntries: [],
    allDeletionEntries: [],
    parentById: new Map(),
    lastJsonlLeafPointer: null,
    activeJsonlLeafId: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function entryTimestamp(value: unknown): number {
  return new Date((value as string | number | Date | undefined) ?? 0).getTime();
}

function entryAllowed(activePathIds: Set<string> | null, id: unknown): boolean {
  return !activePathIds || (typeof id === "string" && activePathIds.has(id));
}

function createSystemEventData(parsed: Record<string, unknown>): Record<string, unknown> {
  return {
    eventType: parsed.eventType,
    eventLabel: parsed.eventLabel,
    data: parsed.data,
    display: parsed.display === true,
  };
}

function createSystemEventMessage(parsed: Record<string, unknown>): Record<string, unknown> {
  return {
    role: "custom",
    customType: "system_event",
    content: `System event: ${(parsed.eventLabel as string | undefined) ?? "System event"}`,
    display: parsed.display === true,
    details: createSystemEventData(parsed),
    timestamp: entryTimestamp(parsed.timestamp),
  };
}

export function appendUiJsonlEntry(options: {
  parsed: Record<string, unknown>;
  messages: unknown[];
  customEntries: UiCustomEntry[];
  activePathIds: Set<string> | null;
  includeMessages: boolean;
}): void {
  const { parsed, messages, customEntries, activePathIds, includeMessages } = options;
  if (parsed.type === "custom") {
    if (!entryAllowed(activePathIds, parsed.id)) return;
    customEntries.push({
      id: (parsed.id as string) ?? `custom-${Date.now()}`,
      customType: (parsed.customType as string) ?? "unknown",
      data: parsed.data,
      timestamp: entryTimestamp(parsed.timestamp),
    });
  } else if (parsed.type === "system_event") {
    if (!entryAllowed(activePathIds, parsed.id)) return;
    customEntries.push({
      id: (parsed.id as string) ?? `system-event-${Date.now()}`,
      customType: "system_event",
      data: createSystemEventData(parsed),
      timestamp: entryTimestamp(parsed.timestamp),
    });
    if (includeMessages && parsed.display === true) {
      messages.push(createSystemEventMessage(parsed));
    }
  } else if (parsed.type === "compaction") {
    if (!entryAllowed(activePathIds, parsed.id)) return;
    messages.push({
      id: parsed.id,
      role: "compactionSummary",
      summary: parsed.summary ?? "",
      tokensBefore: parsed.tokensBefore,
      timestamp: entryTimestamp(parsed.timestamp),
    });
  } else if (includeMessages && parsed.type === "message" && parsed.message) {
    if (!entryAllowed(activePathIds, parsed.id)) return;
    messages.push(parsed.message);
  }
}

export function appendFullJsonlEntry(
  parsed: Record<string, unknown>,
  accumulator: FullMessageAccumulator,
): void {
  const entryId = (parsed.id as string) ?? "";
  const parentId = (parsed.parentId as string | null | undefined) ?? null;
  if (entryId) {
    accumulator.parentById.set(entryId, parentId);
  }

  if (parsed.type === "leaf_pointer" && typeof parsed.leafId === "string") {
    accumulator.lastJsonlLeafPointer = parsed.leafId;
    accumulator.activeJsonlLeafId = parsed.leafId;
    return;
  }

  if (entryId) {
    accumulator.activeJsonlLeafId = entryId;
  }

  if (parsed.type === "custom") {
    accumulator.allCustomEntries.push({
      id: entryId || `custom-${Date.now()}`,
      customType: (parsed.customType as string) ?? "unknown",
      data: parsed.data,
      timestamp: entryTimestamp(parsed.timestamp),
    });
  } else if (parsed.type === "system_event") {
    accumulator.allCustomEntries.push({
      id: entryId || `system-event-${Date.now()}`,
      customType: "system_event",
      data: createSystemEventData(parsed),
      timestamp: entryTimestamp(parsed.timestamp),
    });
    if (parsed.display === true) {
      accumulator.allMessages.push({ entryId, message: createSystemEventMessage(parsed) });
    }
  } else if (parsed.type === "message" && parsed.message) {
    accumulator.allMessages.push({ entryId, message: parsed.message });
  } else if (parsed.type === "compaction") {
    const compactionMessage = {
      role: "compactionSummary",
      summary: (parsed.summary as string) ?? "",
      tokensBefore: parsed.tokensBefore as number | undefined,
      timestamp: entryTimestamp(parsed.timestamp),
    };
    accumulator.allCompactionEntries.push({
      entryId,
      summary: compactionMessage.summary,
      tokensBefore: compactionMessage.tokensBefore,
      timestamp: compactionMessage.timestamp,
    });
    accumulator.allMessages.push({ entryId, message: compactionMessage });
  } else if (parsed.type === "deletion") {
    accumulator.allDeletionEntries.push({
      entryId,
      targetIds: Array.isArray(parsed.targetIds)
        ? parsed.targetIds.filter((targetId): targetId is string => typeof targetId === "string")
        : [],
    });
  }
}

async function appendJsonlFromText(
  text: string,
  onParsed: (parsed: Record<string, unknown>) => void,
  debugLabel: string,
): Promise<void> {
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      onParsed(JSON.parse(line) as Record<string, unknown>);
    } catch (err: unknown) {
      log.debug(`skipping malformed JSONL entry (${debugLabel})`, {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function appendJsonlFromFile(
  sessionPath: string,
  onParsed: (parsed: Record<string, unknown>) => void,
  startByteOffset = 0,
): Promise<{ lineCount: number; byteOffset: number }> {
  if (!sessionPath || !existsSync(sessionPath)) return { lineCount: 0, byteOffset: 0 };
  let lineCount = 0;
  let byteOffset = startByteOffset;
  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8", start: startByteOffset }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      lineCount++;
      // +1 for the newline byte (\n); JSONL files use \n line endings
      byteOffset += Buffer.byteLength(line, "utf-8") + 1;
      if (!line.trim()) continue;
      try {
        onParsed(JSON.parse(line) as Record<string, unknown>);
      } catch (err: unknown) {
        log.debug("skipping malformed JSONL entry", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    rl.close();
  }
  try {
    byteOffset = statSync(sessionPath).size;
  } catch {
    // file gone — keep tracked offset
  }
  return { lineCount, byteOffset };
}

function accumulatorFromCache(hit: SessionCacheHit): FullMessageAccumulator {
  return {
    allMessages: hit.messages,
    allCustomEntries: hit.customEntries,
    allCompactionEntries: hit.compactionEntries,
    allDeletionEntries: hit.deletionEntries ?? [],
    parentById: hit.parentById,
    lastJsonlLeafPointer: hit.lastJsonlLeafPointer,
    activeJsonlLeafId: hit.activeJsonlLeafId,
  };
}

function cacheDataFromAccumulator(
  accumulator: FullMessageAccumulator,
  lineCount: number,
  byteOffset: number,
): SessionCacheData {
  return {
    messages: [...accumulator.allMessages],
    customEntries: [...accumulator.allCustomEntries],
    compactionEntries: [...accumulator.allCompactionEntries],
    deletionEntries: [...accumulator.allDeletionEntries],
    parentById: new Map(accumulator.parentById),
    lastJsonlLeafPointer: accumulator.lastJsonlLeafPointer,
    activeJsonlLeafId: accumulator.activeJsonlLeafId,
    lineCount,
    byteOffset,
  };
}

export async function readFullJsonlAccumulator(options: {
  sessionPath: string;
  readSandboxFile?: (sessionPath: string) => Promise<string>;
}): Promise<FullMessageAccumulator> {
  const accumulator = createFullMessageAccumulator();
  const isSandboxSessionPath = options.sessionPath.startsWith("/root/workspace/sessions/");

  try {
    if (isSandboxSessionPath && options.readSandboxFile) {
      const raw = await options.readSandboxFile(options.sessionPath);
      await appendJsonlFromText(
        raw,
        (parsed) => appendFullJsonlEntry(parsed, accumulator),
        "sandbox",
      );
    } else {
      await appendJsonlFromFile(options.sessionPath, (parsed) =>
        appendFullJsonlEntry(parsed, accumulator),
      );
    }
  } catch (err: unknown) {
    log.warn(
      isSandboxSessionPath ? "Failed to read sandbox JSONL" : "Failed to read entries from JSONL",
      {
        sessionPath: options.sessionPath,
        err: err instanceof Error ? err.message : String(err),
      },
    );
  }

  return accumulator;
}

export async function readFullJsonlAccumulatorCached(options: {
  sessionId: string;
  sessionPath: string;
  readSandboxFile?: (sessionPath: string) => Promise<string>;
  getCache?: (sessionId: string, sessionPath: string) => SessionCacheHit | null;
  setCache?: (sessionId: string, sessionPath: string, data: SessionCacheData) => void;
}): Promise<FullMessageAccumulator> {
  const isSandboxSessionPath = options.sessionPath.startsWith("/root/workspace/sessions/");
  if (isSandboxSessionPath || !options.getCache || !options.setCache) {
    return readFullJsonlAccumulator({
      sessionPath: options.sessionPath,
      readSandboxFile: options.readSandboxFile,
    });
  }

  const t0 = Date.now();
  const cached = options.getCache(options.sessionId, options.sessionPath);
  if (cached && !cached.needsIncremental) {
    perfLog.info("[jsonlCache] hit", {
      sessionId: options.sessionId,
      lineCount: cached.lineCount,
      ms: Date.now() - t0,
    });
    return accumulatorFromCache(cached);
  }

  const accumulator = cached ? accumulatorFromCache(cached) : createFullMessageAccumulator();
  const startByteOffset = cached?.needsIncremental ? cached.byteOffset : 0;
  let totalLineCount = cached?.lineCount ?? 0;

  try {
    const result = await appendJsonlFromFile(
      options.sessionPath,
      (parsed) => appendFullJsonlEntry(parsed, accumulator),
      startByteOffset,
    );
    totalLineCount += result.lineCount;
    options.setCache(
      options.sessionId,
      options.sessionPath,
      cacheDataFromAccumulator(accumulator, totalLineCount, result.byteOffset),
    );
    perfLog.info(cached ? "[jsonlCache] incremental" : "[jsonlCache] miss", {
      sessionId: options.sessionId,
      startByteOffset,
      lineCount: result.lineCount,
      byteOffset: result.byteOffset,
      ms: Date.now() - t0,
    });
  } catch (err: unknown) {
    log.warn("Failed to read cached JSONL accumulator", {
      sessionPath: options.sessionPath,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return accumulator;
}

export async function appendUiJsonlEntriesFromPath(options: {
  sessionPath: string;
  messages: unknown[];
  customEntries: UiCustomEntry[];
  activePathIds: Set<string> | null;
  includeMessages: boolean;
  readSandboxFile?: (sessionPath: string) => Promise<string>;
}): Promise<void> {
  const isSandboxSessionPath = options.sessionPath.startsWith("/root/workspace/sessions/");
  const appendParsed = (parsed: Record<string, unknown>) =>
    appendUiJsonlEntry({
      parsed,
      messages: options.messages,
      customEntries: options.customEntries,
      activePathIds: options.activePathIds,
      includeMessages: options.includeMessages,
    });

  try {
    if (isSandboxSessionPath && options.readSandboxFile) {
      const raw = await options.readSandboxFile(options.sessionPath);
      await appendJsonlFromText(raw, appendParsed, "sandbox getMessages");
    } else {
      await appendJsonlFromFile(options.sessionPath, appendParsed);
    }
  } catch (err: unknown) {
    log.warn(
      isSandboxSessionPath
        ? "Failed to read sandbox JSONL in getMessages"
        : "Failed to read entries from JSONL",
      {
        sessionPath: options.sessionPath,
        err: err instanceof Error ? err.message : String(err),
      },
    );
  }
}

export function buildBranchPathIds(
  parentById: Map<string, string | null>,
  leafId: string | null,
): Set<string> | null {
  if (!leafId || parentById.size === 0 || !parentById.has(leafId)) return null;
  const pathIds = new Set<string>();
  let curId: string | null = leafId;
  while (curId) {
    pathIds.add(curId);
    curId = parentById.get(curId) ?? null;
  }
  return pathIds;
}

export function filterMessagesToBranch(options: {
  allMessages: EntryMessage[];
  allCustomEntries: UiCustomEntry[];
  allDeletionEntries?: DeletionEntry[];
  parentById: Map<string, string | null>;
  leafId: string | null;
}): BranchFilteredMessages {
  const pathIds = buildBranchPathIds(options.parentById, options.leafId);
  const deletedIds = collectDeletedEntryIds(options.allDeletionEntries ?? [], pathIds);
  if (!pathIds) {
    return {
      filteredMessages: options.allMessages.filter((message) => !deletedIds.has(message.entryId)),
      customEntries: options.allCustomEntries,
      leafFound:
        !options.leafId || options.parentById.size === 0 || options.parentById.has(options.leafId),
    };
  }
  const COMPACTION_CUSTOM_TYPES = new Set(["compaction_fold", "compaction_snip"]);
  return {
    filteredMessages: options.allMessages.filter(
      (message) => pathIds.has(message.entryId) && !deletedIds.has(message.entryId),
    ),
    customEntries: options.allCustomEntries.filter(
      (entry) => pathIds.has(entry.id) && !COMPACTION_CUSTOM_TYPES.has(entry.customType),
    ),
    leafFound: true,
  };
}

function collectDeletedEntryIds(
  deletionEntries: DeletionEntry[],
  pathIds: Set<string> | null,
): Set<string> {
  const deletedIds = new Set<string>();
  for (const entry of deletionEntries) {
    if (pathIds && !pathIds.has(entry.entryId)) continue;
    for (const targetId of entry.targetIds) {
      deletedIds.add(targetId);
    }
  }
  return deletedIds;
}

export function filterCustomEntriesToPaginatedMessages(options: {
  customEntries: UiCustomEntry[];
  messages: unknown[];
  allMessageEntryIds?: string[];
  limit?: number;
  afterEntryId?: string;
  fromStart?: boolean;
  parentById: Map<string, string | null>;
  leafId: string | null;
}): UiCustomEntry[] {
  if (options.limit === undefined) return options.customEntries;
  if (options.messages.length === 0) return [];

  const pathOrder = new Map<string, number>();
  const path: string[] = [];
  if (options.leafId && options.parentById.has(options.leafId)) {
    let curId: string | null = options.leafId;
    while (curId) {
      path.push(curId);
      curId = options.parentById.get(curId) ?? null;
    }
    path.reverse();
  } else {
    path.push(...options.parentById.keys());
  }
  path.forEach((id, index) => pathOrder.set(id, index));

  let min = Number.POSITIVE_INFINITY;
  let messageMax = Number.NEGATIVE_INFINITY;
  for (const message of options.messages) {
    if (!isRecord(message) || typeof message.entryId !== "string") continue;
    const order = pathOrder.get(message.entryId);
    if (order === undefined) continue;
    min = Math.min(min, order);
    messageMax = Math.max(messageMax, order);
  }
  if (!Number.isFinite(min)) return [];
  const cursorOrder =
    typeof options.afterEntryId === "string" ? pathOrder.get(options.afterEntryId) : undefined;
  const nextMessageOrderAfterWindow =
    options.fromStart === true
      ? (options.allMessageEntryIds ?? [])
          .map((entryId) => pathOrder.get(entryId))
          .filter((order): order is number => order !== undefined && order > messageMax)
          .sort((a, b) => a - b)[0]
      : undefined;
  const max =
    options.fromStart === true
      ? nextMessageOrderAfterWindow !== undefined
        ? nextMessageOrderAfterWindow - 1
        : pathOrder.size - 1
      : cursorOrder === undefined
        ? pathOrder.size - 1
        : cursorOrder - 1;

  return options.customEntries.filter((entry) => {
    const order = pathOrder.get(entry.id);
    return order !== undefined && order >= min && order <= max;
  });
}

export function filterCustomEntriesToMessageWindow(options: {
  customEntries: UiCustomEntry[];
  messages: unknown[];
  parentById: Map<string, string | null>;
  leafId: string | null;
}): UiCustomEntry[] {
  if (options.messages.length === 0) return [];

  const pathOrder = new Map<string, number>();
  const path: string[] = [];
  if (options.leafId && options.parentById.has(options.leafId)) {
    let curId: string | null = options.leafId;
    while (curId) {
      path.push(curId);
      curId = options.parentById.get(curId) ?? null;
    }
    path.reverse();
  } else {
    path.push(...options.parentById.keys());
  }
  path.forEach((id, index) => pathOrder.set(id, index));

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const message of options.messages) {
    if (!isRecord(message) || typeof message.entryId !== "string") continue;
    const order = pathOrder.get(message.entryId);
    if (order === undefined) continue;
    min = Math.min(min, order);
    max = Math.max(max, order);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];

  return options.customEntries.filter((entry) => {
    const order = pathOrder.get(entry.id);
    return order !== undefined && order >= min && order <= max;
  });
}

export function injectEntryId(entry: EntryMessage): unknown {
  if (isRecord(entry.message) && entry.entryId) {
    return { ...entry.message, entryId: entry.entryId };
  }
  return entry.message;
}

function extractToolCallIds(message: unknown): string[] {
  if (!isRecord(message) || message.role !== "assistant") return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (!isRecord(block) || block.type !== "toolCall") continue;
    if (typeof block.id === "string" && block.id) ids.push(block.id);
  }
  return ids;
}

function extractToolResultId(message: unknown): string | null {
  if (!isRecord(message) || message.role !== "toolResult") return null;
  return typeof message.toolCallId === "string" && message.toolCallId ? message.toolCallId : null;
}

function expandToolPairWindow(
  filteredMessages: EntryMessage[],
  startIndex: number,
  endIndex: number,
): EntryMessage[] {
  const includedIndexes = new Set<number>();
  const toolCallIndexById = new Map<string, number>();
  const toolResultIndexesById = new Map<string, number[]>();

  for (let index = 0; index < filteredMessages.length; index++) {
    const entry = filteredMessages[index];
    for (const toolCallId of extractToolCallIds(entry.message)) {
      toolCallIndexById.set(toolCallId, index);
    }
    const resultToolCallId = extractToolResultId(entry.message);
    if (resultToolCallId) {
      const indexes = toolResultIndexesById.get(resultToolCallId) ?? [];
      indexes.push(index);
      toolResultIndexesById.set(resultToolCallId, indexes);
    }
  }

  // Iterative transitive-closure expansion: when a new entry is added by
  // expansion (e.g. backward from toolResult to the assistant message that
  // contains it), that entry must itself be processed to forward-expand
  // any OTHER tool calls in the same assistant message. Without this,
  // parallel tool calls whose results fall outside the pagination window
  // are orphaned — the assistant message is included but 3 of its 4
  // toolResult children are not, so normalizeToolBlocks can't find their
  // output and the tool cards render empty.
  const toProcess: number[] = [];
  for (let index = startIndex; index < endIndex; index++) {
    if (!includedIndexes.has(index)) {
      includedIndexes.add(index);
      toProcess.push(index);
    }
  }

  while (toProcess.length > 0) {
    const index = toProcess.pop();
    if (index === undefined) break;
    const entry = filteredMessages[index];
    if (!entry) continue;

    // Forward expand: assistant toolCalls → matching toolResults
    for (const toolCallId of extractToolCallIds(entry.message)) {
      for (const resultIndex of toolResultIndexesById.get(toolCallId) ?? []) {
        if (!includedIndexes.has(resultIndex)) {
          includedIndexes.add(resultIndex);
          toProcess.push(resultIndex);
        }
      }
    }

    // Backward expand: toolResult → matching assistant toolCall
    const resultToolCallId = extractToolResultId(entry.message);
    if (resultToolCallId) {
      const callIndex = toolCallIndexById.get(resultToolCallId);
      if (callIndex !== undefined && !includedIndexes.has(callIndex)) {
        includedIndexes.add(callIndex);
        toProcess.push(callIndex);
      }
    }
  }

  return Array.from(includedIndexes)
    .sort((a, b) => a - b)
    .map((index) => filteredMessages[index])
    .filter((entry): entry is EntryMessage => entry !== undefined);
}

export function paginateEntryMessages(options: {
  filteredMessages: EntryMessage[];
  limit?: number;
  afterEntryId?: string;
  beforeEntryId?: string;
  fromStart?: boolean;
}): PaginatedMessages {
  const { filteredMessages, limit, afterEntryId, beforeEntryId, fromStart } = options;
  const totalCount = filteredMessages.length;

  if (beforeEntryId != null && limit !== undefined) {
    const cursorIndex = filteredMessages.findIndex((entry) => entry.entryId === beforeEntryId);
    if (cursorIndex < 0) {
      return { slicedMessages: [], hasMore: false, nextCursor: null };
    }
    const startIndex = cursorIndex + 1;
    const endIndex = Math.min(totalCount, startIndex + limit);
    const slicedMessages = expandToolPairWindow(filteredMessages, startIndex, endIndex).map(
      injectEntryId,
    );
    const hasMore = endIndex < totalCount;
    return {
      slicedMessages,
      hasMore,
      nextCursor: hasMore ? (filteredMessages[endIndex - 1]?.entryId ?? null) : null,
    };
  }

  const cursorIndex =
    afterEntryId != null
      ? filteredMessages.findIndex((entry) => entry.entryId === afterEntryId)
      : -1;

  if (afterEntryId != null && cursorIndex < 0) {
    return { slicedMessages: [], hasMore: false, nextCursor: null };
  }

  if (limit !== undefined && fromStart === true) {
    const startIndex = 0;
    const endIndex = Math.min(totalCount, limit);
    return {
      slicedMessages: expandToolPairWindow(filteredMessages, startIndex, endIndex).map(
        injectEntryId,
      ),
      hasMore: false,
      nextCursor: null,
    };
  }

  if (limit !== undefined) {
    const endIndex = cursorIndex >= 0 ? cursorIndex : totalCount;
    const startIndex = Math.max(0, endIndex - limit);
    const slicedMessages = expandToolPairWindow(filteredMessages, startIndex, endIndex).map(
      injectEntryId,
    );
    const hasMore = startIndex > 0;
    return {
      slicedMessages,
      hasMore,
      nextCursor: hasMore ? (filteredMessages[startIndex]?.entryId ?? null) : null,
    };
  }

  return {
    slicedMessages: filteredMessages.map(injectEntryId),
    hasMore: false,
    nextCursor: null,
  };
}

export function getEntryMessageWindowAround(options: {
  filteredMessages: EntryMessage[];
  targetEntryId: string;
  before?: number;
  after?: number;
}): AroundEntryMessages {
  const { filteredMessages, targetEntryId } = options;
  const targetIndex = filteredMessages.findIndex((entry) => entry.entryId === targetEntryId);
  if (targetIndex < 0) {
    return {
      slicedMessages: [],
      hasMoreBefore: false,
      hasMoreAfter: false,
      beforeCursor: null,
      afterCursor: null,
      targetFound: false,
    };
  }

  const before = Math.max(0, Math.floor(options.before ?? 25));
  const after = Math.max(0, Math.floor(options.after ?? 25));
  const startIndex = Math.max(0, targetIndex - before);
  const endIndex = Math.min(filteredMessages.length, targetIndex + after + 1);
  const slicedEntries = expandToolPairWindow(filteredMessages, startIndex, endIndex);
  const firstEntry = slicedEntries[0];
  const lastEntry = slicedEntries[slicedEntries.length - 1];

  return {
    slicedMessages: slicedEntries.map(injectEntryId),
    hasMoreBefore: startIndex > 0,
    hasMoreAfter: endIndex < filteredMessages.length,
    beforeCursor: firstEntry?.entryId ?? null,
    afterCursor: lastEntry?.entryId ?? null,
    targetFound: true,
  };
}
