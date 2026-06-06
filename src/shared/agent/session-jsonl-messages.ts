import { createReadStream, existsSync } from "fs";
import * as readline from "readline";

import { createLogger } from "../lib/logger";

const log = createLogger("agent");

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

export interface FullMessageAccumulator {
  allMessages: EntryMessage[];
  allCustomEntries: UiCustomEntry[];
  allCompactionEntries: CompactionEntry[];
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

function createFullMessageAccumulator(): FullMessageAccumulator {
  return {
    allMessages: [],
    allCustomEntries: [],
    allCompactionEntries: [],
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
): Promise<void> {
  if (!sessionPath || !existsSync(sessionPath)) return;
  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
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
  parentById: Map<string, string | null>;
  leafId: string | null;
}): BranchFilteredMessages {
  const pathIds = buildBranchPathIds(options.parentById, options.leafId);
  if (!pathIds) {
    return {
      filteredMessages: options.allMessages,
      customEntries: options.allCustomEntries,
      leafFound:
        !options.leafId || options.parentById.size === 0 || options.parentById.has(options.leafId),
    };
  }
  return {
    filteredMessages: options.allMessages.filter((message) => pathIds.has(message.entryId)),
    customEntries: options.allCustomEntries.filter((entry) => pathIds.has(entry.id)),
    leafFound: true,
  };
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

  for (let index = startIndex; index < endIndex; index++) {
    includedIndexes.add(index);
    const entry = filteredMessages[index];

    for (const toolCallId of extractToolCallIds(entry.message)) {
      for (const resultIndex of toolResultIndexesById.get(toolCallId) ?? []) {
        includedIndexes.add(resultIndex);
      }
    }

    const resultToolCallId = extractToolResultId(entry.message);
    if (resultToolCallId) {
      const callIndex = toolCallIndexById.get(resultToolCallId);
      if (callIndex !== undefined) includedIndexes.add(callIndex);
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
}): PaginatedMessages {
  const { filteredMessages, limit, afterEntryId } = options;
  const totalCount = filteredMessages.length;
  const cursorIndex =
    afterEntryId != null
      ? filteredMessages.findIndex((entry) => entry.entryId === afterEntryId)
      : -1;

  if (afterEntryId != null && cursorIndex < 0) {
    return { slicedMessages: [], hasMore: false, nextCursor: null };
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
