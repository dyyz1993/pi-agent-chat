/**
 * Branch filtering logic for session messages.
 *
 * Extracted from SessionMessageReader as pure functions — no class state.
 * Used to filter messages to the current branch (leaf→root path) and
 * apply pagination (limit / afterEntryId cursor).
 */

import type { ParsedMessageEntry, ParsedCustomEntry } from "./session-jsonl-parser";

/**
 * Build the set of entry IDs from a leaf node up to the root.
 * Returns a Set of entry IDs that form the active branch path.
 */
export function buildBranchPathSet(
  leafId: string,
  parentById: Map<string, string | null>,
): Set<string> {
  const pathIds = new Set<string>();
  let curId: string | null = leafId;
  while (curId) {
    pathIds.add(curId);
    const parent = parentById.get(curId);
    curId = parent ?? null;
  }
  return pathIds;
}

/**
 * Internal compaction custom types that should be excluded from
 * the frontend customEntries (they are metadata, not user-facing).
 */
const COMPACTION_CUSTOM_TYPES = new Set(["compaction_fold", "compaction_snip"]);

/**
 * Filter message entries to only those on the current branch path.
 * Falls back to returning all messages if pathIds is empty.
 */
export function filterMessagesToBranch(
  allMessages: ParsedMessageEntry[],
  pathIds: Set<string> | null,
): ParsedMessageEntry[] {
  if (!pathIds || pathIds.size === 0) return allMessages;
  return allMessages.filter((m) => pathIds.has(m.entryId));
}

/**
 * Filter custom entries to the current branch path, excluding
 * internal compaction metadata types.
 */
export function filterCustomEntriesToBranch(
  allCustomEntries: ParsedCustomEntry[],
  pathIds: Set<string> | null,
): ParsedCustomEntry[] {
  if (!pathIds || pathIds.size === 0) return allCustomEntries;
  return allCustomEntries.filter(
    (e) => pathIds.has(e.id) && !COMPACTION_CUSTOM_TYPES.has(e.customType),
  );
}

export function filterCustomEntriesToPaginatedMessages(
  customEntries: ParsedCustomEntry[],
  messages: unknown[],
  options: PaginationOptions,
  parentById: Map<string, string | null>,
  leafId: string | null,
  allMessageEntryIds: string[] = [],
): ParsedCustomEntry[] {
  if (options.limit === undefined) return customEntries;
  if (messages.length === 0) return [];

  const pathOrder = new Map<string, number>();
  const path: string[] = [];
  if (leafId && parentById.has(leafId)) {
    let curId: string | null = leafId;
    while (curId) {
      path.push(curId);
      curId = parentById.get(curId) ?? null;
    }
    path.reverse();
  } else {
    path.push(...parentById.keys());
  }
  path.forEach((id, index) => pathOrder.set(id, index));

  let min = Number.POSITIVE_INFINITY;
  let messageMax = Number.NEGATIVE_INFINITY;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const entryId = (message as Record<string, unknown>).entryId;
    if (typeof entryId !== "string") continue;
    const order = pathOrder.get(entryId);
    if (order === undefined) continue;
    min = Math.min(min, order);
    messageMax = Math.max(messageMax, order);
  }
  if (!Number.isFinite(min)) return [];
  const cursorOrder =
    typeof options.afterEntryId === "string" ? pathOrder.get(options.afterEntryId) : undefined;
  const nextMessageOrderAfterWindow =
    options.fromStart === true
      ? allMessageEntryIds
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

  return customEntries.filter((entry) => {
    const order = pathOrder.get(entry.id);
    return order !== undefined && order >= min && order <= max;
  });
}

/**
 * Inject entryId into a message object for frontend consumption.
 */
function injectEntryId(e: ParsedMessageEntry): unknown {
  const msg = e.message as Record<string, unknown>;
  if (msg && typeof msg === "object" && e.entryId) {
    return { ...msg, entryId: e.entryId };
  }
  return msg;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractToolCallIds(message: unknown): string[] {
  if (!isRecord(message) || message.role !== "assistant") return [];
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "toolCall")
    .map((block) => block.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function extractToolResultId(message: unknown): string | null {
  if (!isRecord(message) || message.role !== "toolResult") return null;
  return typeof message.toolCallId === "string" && message.toolCallId ? message.toolCallId : null;
}

function expandToolPairWindow(
  filteredMessages: ParsedMessageEntry[],
  startIndex: number,
  endIndex: number,
): ParsedMessageEntry[] {
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

  const toProcess: number[] = [];
  for (let index = startIndex; index < endIndex; index++) {
    includedIndexes.add(index);
    toProcess.push(index);
  }

  while (toProcess.length > 0) {
    const index = toProcess.pop();
    if (index === undefined) break;
    const entry = filteredMessages[index];
    if (!entry) continue;

    for (const toolCallId of extractToolCallIds(entry.message)) {
      for (const resultIndex of toolResultIndexesById.get(toolCallId) ?? []) {
        if (!includedIndexes.has(resultIndex)) {
          includedIndexes.add(resultIndex);
          toProcess.push(resultIndex);
        }
      }
    }

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
    .filter((entry): entry is ParsedMessageEntry => entry !== undefined);
}

export interface PaginationOptions {
  limit?: number;
  afterEntryId?: string;
  fromStart?: boolean;
}

export interface PaginationResult {
  messages: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Apply pagination to filtered messages.
 *
 * With fromStart=true, returns the oldest page.
 * Without a cursor (afterEntryId=null), returns the newest page.
 * With afterEntryId, returns the page immediately before that entry
 * (for prepending older history).
 */
export function applyPagination(
  filteredMessages: ParsedMessageEntry[],
  options: PaginationOptions,
): PaginationResult {
  const totalCount = filteredMessages.length;
  const limit = options.limit;
  const afterEntryId = options.afterEntryId;
  const fromStart = options.fromStart === true;
  let hasMore = false;
  let nextCursor: string | null = null;

  let slicedMessages: unknown[];

  const cursorIndex =
    afterEntryId != null
      ? filteredMessages.findIndex((entry) => entry.entryId === afterEntryId)
      : -1;

  if (afterEntryId != null && cursorIndex < 0) {
    // afterEntryId not found — return empty page
    slicedMessages = [];
  } else if (limit !== undefined && fromStart) {
    const startIndex = 0;
    const endIndex = Math.min(totalCount, limit);
    slicedMessages = expandToolPairWindow(filteredMessages, startIndex, endIndex).map(
      injectEntryId,
    );
    hasMore = false;
    nextCursor = null;
  } else if (limit !== undefined) {
    const endIndex = cursorIndex >= 0 ? cursorIndex : totalCount;
    const startIndex = Math.max(0, endIndex - limit);
    slicedMessages = expandToolPairWindow(filteredMessages, startIndex, endIndex).map(
      injectEntryId,
    );
    hasMore = startIndex > 0;
    nextCursor = hasMore ? (filteredMessages[startIndex]?.entryId ?? null) : null;
  } else {
    slicedMessages = filteredMessages.map(injectEntryId);
  }

  return { messages: slicedMessages, hasMore, nextCursor };
}
