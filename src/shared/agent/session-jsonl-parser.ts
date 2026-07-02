import { createReadStream } from "fs";
import { statSync } from "fs";
import * as readline from "readline";

import { createLogger } from "../lib/logger";

const log = createLogger("agent");

/**
 * Types for parsed JSONL entries — shared across all parsing functions.
 */
export interface ParsedMessageEntry {
  entryId: string;
  message: unknown;
}

export interface ParsedCustomEntry {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
}

export interface ParsedCompactionEntry {
  entryId: string;
  summary: string;
  tokensBefore?: number;
  timestamp: number;
}

export interface JsonlTreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
  label?: string;
}

/**
 * Result of a full JSONL parse (used by getFullMessages cold read + sandbox).
 */
export interface FullJsonlParseResult {
  messages: ParsedMessageEntry[];
  customEntries: ParsedCustomEntry[];
  compactionEntries: ParsedCompactionEntry[];
  parentById: Map<string, string | null>;
  lastLeafPointer: string | null;
  activeJsonlLeafId: string | null;
  totalLines: number;
}

/**
 * Result of an incremental JSONL read from a byte offset.
 */
export interface IncrementalJsonlReadResult {
  newEntries: number;
  totalLines: number;
  newByteOffset: number;
  newCompactionEntries: ParsedCompactionEntry[];
  lastLeafPointer: string | null;
}

/**
 * Parse a single JSONL line into a structured entry. Returns null for
 * malformed or non-applicable lines.
 *
 * Extracts the common per-line parsing logic shared by all read paths.
 */
function parseJsonlLine(line: string): {
  entryId: string;
  parentId: string | null;
  parsed: Record<string, unknown>;
} | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const entryId = (parsed.id as string) ?? "";
    const parentId = (parsed.parentId as string | null | undefined) ?? null;
    return { entryId, parentId, parsed };
  } catch {
    return null;
  }
}

function entryTimestamp(value: unknown): number {
  return new Date((value as string | number | Date | undefined) ?? 0).getTime();
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

/**
 * Process a parsed JSONL entry and append to the appropriate arrays.
 * Handles message, custom, compaction, and leaf_pointer types.
 *
 * @returns the type of entry processed, or null if skipped.
 */
function appendParsedEntry(
  parsed: Record<string, unknown>,
  entryId: string,
  messages: ParsedMessageEntry[],
  customEntries: ParsedCustomEntry[],
  compactionEntries?: ParsedCompactionEntry[],
  leafState?: { lastLeafPointer: string | null; activeJsonlLeafId: string | null },
): "message" | "custom" | "compaction" | "leaf_pointer" | null {
  if (parsed.type === "message" && parsed.message) {
    messages.push({ entryId, message: parsed.message });
    if (leafState) {
      leafState.activeJsonlLeafId = entryId;
    }
    return "message";
  }

  if (parsed.type === "custom") {
    customEntries.push({
      id: entryId || `custom-${Date.now()}`,
      customType: (parsed.customType as string) ?? "unknown",
      data: parsed.data,
      timestamp: entryTimestamp(parsed.timestamp),
    });
    return "custom";
  }

  if (parsed.type === "system_event") {
    customEntries.push({
      id: entryId || `system-event-${Date.now()}`,
      customType: "system_event",
      data: createSystemEventData(parsed),
      timestamp: entryTimestamp(parsed.timestamp),
    });
    if (parsed.display === true) {
      messages.push({ entryId, message: createSystemEventMessage(parsed) });
    }
    return "custom";
  }

  if (parsed.type === "compaction") {
    const compEntry: ParsedCompactionEntry = {
      entryId,
      summary: (parsed.summary as string) ?? "",
      tokensBefore: parsed.tokensBefore as number | undefined,
      timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
    };
    if (compactionEntries) {
      compactionEntries.push(compEntry);
    }
    // Inject compaction as a message in-place to preserve chronological order
    messages.push({
      entryId,
      message: {
        role: "compactionSummary",
        summary: compEntry.summary,
        tokensBefore: compEntry.tokensBefore,
        timestamp: compEntry.timestamp,
      },
    });
    if (leafState) {
      leafState.activeJsonlLeafId = entryId;
    }
    return "compaction";
  }

  if (parsed.type === "leaf_pointer" && typeof parsed.leafId === "string") {
    if (leafState) {
      leafState.lastLeafPointer = parsed.leafId;
      leafState.activeJsonlLeafId = parsed.leafId;
    }
    return "leaf_pointer";
  }

  return null;
}

/**
 * Read a JSONL file fully and parse all entries in a single pass.
 * Used for cold reads (no cache) and sandbox reads.
 *
 * This is a pure function — no class state, no side effects on the file.
 */
export async function readJsonlFully(sessionPath: string): Promise<FullJsonlParseResult> {
  const messages: ParsedMessageEntry[] = [];
  const customEntries: ParsedCustomEntry[] = [];
  const compactionEntries: ParsedCompactionEntry[] = [];
  const parentById = new Map<string, string | null>();
  const leafState = {
    lastLeafPointer: null as string | null,
    activeJsonlLeafId: null as string | null,
  };
  let totalLines = 0;

  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    totalLines++;
    const result = parseJsonlLine(line);
    if (!result) continue;
    const { entryId, parentId, parsed } = result;
    if (entryId) {
      parentById.set(entryId, parentId);
    }
    appendParsedEntry(parsed, entryId, messages, customEntries, compactionEntries, leafState);
  }
  rl.close();

  return {
    messages,
    customEntries,
    compactionEntries,
    parentById,
    lastLeafPointer: leafState.lastLeafPointer,
    activeJsonlLeafId: leafState.activeJsonlLeafId,
    totalLines,
  };
}

/**
 * Read JSONL from a specific byte offset for incremental appends.
 * Uses createReadStream({ start }) for O(1) seek.
 *
 * Appends directly into the provided arrays (mutates them).
 */
export async function readJsonlFromByteOffset(
  sessionPath: string,
  byteOffset: number,
  messages: ParsedMessageEntry[],
  customEntries: ParsedCustomEntry[],
  parentById: Map<string, string | null>,
): Promise<IncrementalJsonlReadResult> {
  let lineIndex = 0;
  let newEntries = 0;
  const newCompactionEntries: ParsedCompactionEntry[] = [];
  const leafState = {
    lastLeafPointer: null as string | null,
    activeJsonlLeafId: null as string | null,
  };

  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8", start: byteOffset }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lineIndex++;
    const result = parseJsonlLine(line);
    if (!result) continue;
    const { entryId, parentId, parsed } = result;
    if (entryId) {
      parentById.set(entryId, parentId);
    }
    const entryType = appendParsedEntry(
      parsed,
      entryId,
      messages,
      customEntries,
      newCompactionEntries,
      leafState,
    );
    if (entryType === "message" || entryType === "custom" || entryType === "compaction") {
      newEntries++;
    }
  }
  rl.close();

  let newByteOffset = byteOffset;
  try {
    newByteOffset = statSync(sessionPath).size;
  } catch {
    // file gone — keep original offset
  }

  return {
    newEntries,
    totalLines: lineIndex,
    newByteOffset,
    newCompactionEntries,
    lastLeafPointer: leafState.lastLeafPointer,
  };
}

/**
 * Read JSONL from a specific physical line number onwards.
 * Appends directly into the provided arrays (mutates them).
 *
 * Note: This skips lines one-by-one (O(n) seek). For byte-offset based
 * incremental reads, use readJsonlFromByteOffset instead.
 */
export async function readJsonlFromLine(
  sessionPath: string,
  startLine: number,
  messages: ParsedMessageEntry[],
  customEntries: ParsedCustomEntry[],
  parentById: Map<string, string | null>,
): Promise<{ newEntries: number; totalLines: number }> {
  let lineIndex = 0;
  let newEntries = 0;

  const rl = readline.createInterface({
    input: createReadStream(sessionPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    lineIndex++;
    if (lineIndex <= startLine) continue;
    const result = parseJsonlLine(line);
    if (!result) continue;
    const { entryId, parentId, parsed } = result;
    if (entryId) {
      parentById.set(entryId, parentId);
    }
    // Note: this path does NOT collect compactionEntries (legacy behavior)
    const entryType = appendParsedEntry(parsed, entryId, messages, customEntries);
    if (entryType === "message" || entryType === "custom" || entryType === "compaction") {
      newEntries++;
    }
  }
  rl.close();

  return { newEntries, totalLines: lineIndex };
}

/**
 * Read JSONL entries for tree structure (getTree / navigateTree).
 * Returns lightweight entries without full message content.
 */
export async function readJsonlTreeEntries(sessionPath: string): Promise<JsonlTreeEntry[]> {
  const entries: JsonlTreeEntry[] = [];
  if (!sessionPath) return entries;

  const { existsSync } = await import("fs");
  if (!existsSync(sessionPath)) return entries;

  try {
    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      const result = parseJsonlLine(line);
      if (!result) continue;
      const { entryId, parentId, parsed } = result;
      if (entryId && parsed.type) {
        let label: string | undefined;
        if (
          parsed.type === "message" &&
          parsed.message &&
          typeof parsed.message === "object" &&
          parsed.message !== null
        ) {
          label = (parsed.message as Record<string, unknown>).role as string | undefined;
        } else if (parsed.customType) {
          label = parsed.customType as string;
        }
        entries.push({
          id: entryId,
          parentId,
          type: parsed.type as string,
          customType: parsed.customType as string | undefined,
          label,
        });
      }
    }
    rl.close();
  } catch (err: unknown) {
    log.warn("readJsonlTreeEntries: failed to read file", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return entries;
}

/**
 * Parse JSONL from raw text content (for sandbox reads where we get
 * the full file content via execInSandbox).
 */
export function parseJsonlFromText(
  text: string,
): Pick<
  FullJsonlParseResult,
  | "messages"
  | "customEntries"
  | "compactionEntries"
  | "parentById"
  | "lastLeafPointer"
  | "activeJsonlLeafId"
> {
  const messages: ParsedMessageEntry[] = [];
  const customEntries: ParsedCustomEntry[] = [];
  const compactionEntries: ParsedCompactionEntry[] = [];
  const parentById = new Map<string, string | null>();
  const leafState = {
    lastLeafPointer: null as string | null,
    activeJsonlLeafId: null as string | null,
  };

  const lines = text.split("\n");
  for (const line of lines) {
    const result = parseJsonlLine(line);
    if (!result) continue;
    const { entryId, parentId, parsed } = result;
    if (entryId) {
      parentById.set(entryId, parentId);
      leafState.activeJsonlLeafId = entryId;
    }
    appendParsedEntry(parsed, entryId, messages, customEntries, compactionEntries, leafState);
  }

  return {
    messages,
    customEntries,
    compactionEntries,
    parentById,
    lastLeafPointer: leafState.lastLeafPointer,
    activeJsonlLeafId: leafState.activeJsonlLeafId,
  };
}
