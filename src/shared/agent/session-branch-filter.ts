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

export interface PaginationOptions {
  limit?: number;
  afterEntryId?: string;
}

export interface PaginationResult {
  messages: unknown[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Apply pagination to filtered messages.
 *
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
  } else if (limit !== undefined) {
    const endIndex = cursorIndex >= 0 ? cursorIndex : totalCount;
    const startIndex = Math.max(0, endIndex - limit);
    slicedMessages = filteredMessages.slice(startIndex, endIndex).map(injectEntryId);
    hasMore = startIndex > 0;
    nextCursor = hasMore ? (filteredMessages[startIndex]?.entryId ?? null) : null;
  } else {
    slicedMessages = filteredMessages.map(injectEntryId);
  }

  return { messages: slicedMessages, hasMore, nextCursor };
}
