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
  } else if (parsed.type === "leaf_pointer" && typeof parsed.leafId === "string") {
    accumulator.lastJsonlLeafPointer = parsed.leafId;
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
    const slicedMessages = filteredMessages.slice(startIndex, endIndex).map(injectEntryId);
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
