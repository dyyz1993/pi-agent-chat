import { existsSync, statSync } from "fs";
import { performance } from "perf_hooks";

import type { AgentMessageForUI } from "../modules/agent";
import type { TreeEntry } from "../modules/agent";
import { createLogger } from "../lib/logger";

// Extracted modules (pure functions, no class state)
import {
  readJsonlFromByteOffset as readJsonlFromByteOffsetRaw,
  readJsonlFromLine as readJsonlFromLineRaw,
  readJsonlTreeEntries,
  readJsonlFully,
  parseJsonlFromText,
  type ParsedMessageEntry,
  type ParsedCustomEntry,
} from "./session-jsonl-parser";
import {
  buildBranchPathSet,
  filterMessagesToBranch,
  filterCustomEntriesToBranch,
  applyPagination,
} from "./session-branch-filter";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

/**
 * Race a promise against a timeout. Rejects with a descriptive error if the
 * promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

interface ManagedClient {
  client: {
    getMessages(): Promise<unknown[]>;
    getTreeWithLeaf(): Promise<{ entries: unknown[]; leafId?: string | null }>;
    navigateTree(
      targetId: string,
      options?: { summarize?: boolean; skipFiles?: boolean },
    ): Promise<{ cancelled: boolean; reason?: string }>;
  };
  info: {
    sessionPath: string;
    status: string;
  };
  _activeSessionId: string;
}

interface SandboxManagerLike {
  execInSandbox(userId: string, command: string): Promise<string>;
}

export interface SessionMessageReaderDeps {
  getActiveManaged: (sessionId: string) => ManagedClient | undefined;
  resolveSessionPath: (sessionId: string) => string;
  _getSandboxUserId: (sessionId: string) => string | undefined;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  clients: Map<string, ManagedClient>;
  getSandboxManager: () => SandboxManagerLike | null;
  leafIds: Map<string, string | null>;
}

export class SessionMessageReader {
  private deps: SessionMessageReaderDeps;

  private sessionMsgCache = new Map<
    string,
    {
      messages: Array<{ entryId: string; message: unknown }>;
      customEntries: Array<{
        id: string;
        customType: string;
        data: unknown;
        timestamp: number;
      }>;
      compactionEntries: Array<{
        entryId: string;
        summary: string;
        tokensBefore?: number;
        timestamp: number;
      }>;
      parentById: Map<string, string | null>;
      fileSize: number;
      mtimeMs: number;
      lineCount: number;
      lastJsonlLeafPointer: string | null;
      // The deepest/latest entry appended after the last leaf_pointer. The
      // on-disk leaf_pointer is only written by branch()/resetLeaf(), NOT by
      // normal message appends, so it can lag behind. activeJsonlLeafId is the
      // true current leaf (mirrors CLI _buildIndex "deepest descendant").
      activeJsonlLeafId?: string | null;
      byteOffset: number;
    }
  >();
  private static SESSION_CACHE_MAX = 25;

  constructor(deps: SessionMessageReaderDeps) {
    this.deps = deps;
  }

  private resolveReadableSessionPath(sessionId: string, sessionPath?: string): string {
    if (sessionPath) return sessionPath;
    return this.deps.resolveSessionPath(sessionId) || "";
  }

  /**
   * Get cached session data. Three outcomes:
   * 1. Exact match (file unchanged) → return cached data
   * 2. File grew → return cached data + mark for incremental append
   * 3. No cache / file shrunk / file gone → return null
   */
  getSessionCache(
    sessionId: string,
    sessionPath: string,
  ): {
    messages: Array<{ entryId: string; message: unknown }>;
    customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }>;
    compactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }>;
    parentById: Map<string, string | null>;
    lineCount: number;
    lastJsonlLeafPointer: string | null;
    activeJsonlLeafId?: string | null;
    byteOffset: number;
    needsIncremental: boolean;
  } | null {
    const cached = this.sessionMsgCache.get(sessionId);
    if (!cached) return null;
    try {
      const st = statSync(sessionPath);
      if (st.size === cached.fileSize && st.mtimeMs === cached.mtimeMs) {
        // Exact match — file unchanged
        this.sessionMsgCache.delete(sessionId);
        this.sessionMsgCache.set(sessionId, cached);
        return { ...cached, needsIncremental: false };
      }
      if (st.size > cached.fileSize) {
        // File grew — can do incremental append
        this.sessionMsgCache.delete(sessionId);
        this.sessionMsgCache.set(sessionId, cached);
        return { ...cached, needsIncremental: true };
      }
      // File shrunk or changed drastically — invalidate
    } catch {
      // file gone or inaccessible
    }
    this.sessionMsgCache.delete(sessionId);
    return null;
  }

  setSessionCache(
    sessionId: string,
    sessionPath: string,
    data: {
      messages: Array<{ entryId: string; message: unknown }>;
      customEntries: Array<{
        id: string;
        customType: string;
        data: unknown;
        timestamp: number;
      }>;
      compactionEntries: Array<{
        entryId: string;
        summary: string;
        tokensBefore?: number;
        timestamp: number;
      }>;
      parentById: Map<string, string | null>;
      lineCount: number;
      lastJsonlLeafPointer: string | null;
      activeJsonlLeafId?: string | null;
      byteOffset?: number;
    },
  ): void {
    try {
      const st = statSync(sessionPath);
      if (this.sessionMsgCache.size >= SessionMessageReader.SESSION_CACHE_MAX) {
        const oldest = this.sessionMsgCache.keys().next().value;
        if (oldest) this.sessionMsgCache.delete(oldest);
      }
      this.sessionMsgCache.set(sessionId, {
        ...data,
        fileSize: st.size,
        mtimeMs: st.mtimeMs,
        byteOffset: data.byteOffset ?? st.size,
      });
    } catch {
      // file gone — don't cache
    }
  }

  clearSessionCache(sessionId?: string): void {
    if (sessionId) {
      this.sessionMsgCache.delete(sessionId);
    } else {
      this.sessionMsgCache.clear();
    }
  }

  /**
   * Read JSONL from a specific physical line number onwards and append results.
   * Returns { newEntries: number of new parsed entries, totalLines: total physical lines in file }
   *
   * Delegates to session-jsonl-parser module.
   */
  async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{ newEntries: number; totalLines: number }> {
    return readJsonlFromLineRaw(
      sessionPath,
      startLine,
      messages as ParsedMessageEntry[],
      customEntries as ParsedCustomEntry[],
      parentById,
    );
  }

  /**
   * Read JSONL from a specific byte offset onwards. Unlike readJsonlFromLine
   * which skips lines one-by-one, this uses createReadStream({ start }) for
   * O(1) seek. Also collects compaction and leaf_pointer entries in one pass.
   *
   * Delegates to session-jsonl-parser module.
   */
  async readJsonlFromByteOffset(
    sessionPath: string,
    byteOffset: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{
    newEntries: number;
    totalLines: number;
    newByteOffset: number;
    newCompactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }>;
    lastLeafPointer: string | null;
  }> {
    return readJsonlFromByteOffsetRaw(
      sessionPath,
      byteOffset,
      messages as ParsedMessageEntry[],
      customEntries as ParsedCustomEntry[],
      parentById,
    );
  }

  private async readJsonlEntries(sessionPath: string): Promise<
    Array<{
      id: string;
      parentId: string | null;
      type: string;
      customType?: string;
      label?: string;
    }>
  > {
    return readJsonlTreeEntries(sessionPath);
  }

  private buildMessagesFromJsonl(
    _entries: Array<{ id: string; parentId: string | null; type: string }>,
    _leafId: string | null,
  ): unknown[] {
    return [];
  }

  async getMessages(
    sessionId: string,
    sessionPath?: string,
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }> {
    const managed = this.deps.getActiveManaged(sessionId);

    let messages: unknown[] = [];
    let resolvedSessionPath = sessionPath ?? "";
    let activePathIds: Set<string> | null = null;

    if (managed) {
      resolvedSessionPath = managed.info.sessionPath;
      try {
        const messagesResult = await withTimeout(
          managed.client.getMessages(),
          15_000,
          "getMessages",
        );
        if (messagesResult) {
          messages = messagesResult;
        }
      } catch (err: unknown) {
        log.warn("getMessages SDK failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const treeResult = await withTimeout(
          managed.client.getTreeWithLeaf(),
          10_000,
          "getTreeWithLeaf",
        );
        const entries = treeResult.entries;
        const leafId = treeResult.leafId;
        if (leafId) {
          this.deps.leafIds.set(sessionId, leafId);
        }
        if (Array.isArray(entries) && leafId) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; label?: string }
          >();
          for (const rawE of entries) {
            const e = rawE as { id: string; parentId: string | null; type: string; label?: string };
            byId.set(e.id, e);
          }
          activePathIds = new Set<string>();
          let curId: string | null | undefined = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId =
              node && typeof node.parentId === "string" && node.parentId
                ? node.parentId
                : undefined;
          }
        }
      } catch (err: unknown) {
        log.warn("getTreeWithLeaf failed in getMessages", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      resolvedSessionPath = this.resolveReadableSessionPath(sessionId, sessionPath);
      const leafId = this.deps.leafIds.get(sessionId) ?? null;
      if (resolvedSessionPath && leafId !== undefined) {
        const jsonlEntries = await this.readJsonlEntries(resolvedSessionPath);
        if (jsonlEntries.length > 0 && leafId !== null) {
          const byId = new Map<
            string,
            { id: string; parentId: string | null; type: string; customType?: string }
          >();
          for (const e of jsonlEntries) byId.set(e.id, e);
          activePathIds = new Set<string>();
          let curId: string | null = leafId;
          while (curId) {
            activePathIds.add(curId);
            const node = byId.get(curId);
            curId = node?.parentId ?? null;
          }
        }
        messages = this.buildMessagesFromJsonl(jsonlEntries, leafId);
      }
    }

    const customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];
    const isSandboxSessionPath = resolvedSessionPath?.startsWith("/root/workspace/sessions/");

    if (isSandboxSessionPath && !managed) {
      const sandboxManager = this.deps.getSandboxManager();
      if (sandboxManager) {
        try {
          const userId = this.deps._getSandboxUserId(sessionId);
          if (userId) {
            const raw = await sandboxManager.execInSandbox(userId, `cat ${resolvedSessionPath}`);
            const lines = raw.split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line) as Record<string, unknown>;
                if (parsed.type === "custom") {
                  if (
                    activePathIds &&
                    typeof parsed.id === "string" &&
                    !activePathIds.has(parsed.id)
                  )
                    continue;
                  customEntries.push({
                    id: (parsed.id as string) ?? `custom-${Date.now()}`,
                    customType: (parsed.customType as string) ?? "unknown",
                    data: parsed.data,
                    timestamp: new Date(
                      (parsed.timestamp as string | number | Date) ?? 0,
                    ).getTime(),
                  });
                } else if (parsed.type === "compaction") {
                  if (
                    activePathIds &&
                    typeof parsed.id === "string" &&
                    !activePathIds.has(parsed.id)
                  )
                    continue;
                  messages.push({
                    id: parsed.id,
                    role: "compactionSummary",
                    summary: parsed.summary ?? "",
                    tokensBefore: parsed.tokensBefore,
                    timestamp: new Date(
                      (parsed.timestamp as string | number | Date) ?? 0,
                    ).getTime(),
                  });
                } else if (parsed.type === "message" && parsed.message) {
                  if (
                    activePathIds &&
                    typeof parsed.id === "string" &&
                    !activePathIds.has(parsed.id)
                  )
                    continue;
                  messages.push(parsed.message);
                }
              } catch (err: unknown) {
                log.debug("skipping malformed JSONL entry (sandbox getMessages)", {
                  err: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        } catch (err: unknown) {
          log.warn("Failed to read sandbox JSONL in getMessages", {
            sessionPath: resolvedSessionPath,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
      try {
        const { createReadStream } = await import("fs");
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            if (parsed.type === "custom") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              customEntries.push({
                id: (parsed.id as string) ?? `custom-${Date.now()}`,
                customType: (parsed.customType as string) ?? "unknown",
                data: parsed.data,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (parsed.type === "compaction") {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push({
                id: parsed.id,
                role: "compactionSummary",
                summary: parsed.summary ?? "",
                tokensBefore: parsed.tokensBefore,
                timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
              });
            } else if (!managed && parsed.type === "message" && parsed.message) {
              if (
                activePathIds &&
                typeof parsed.id === "string" &&
                !activePathIds.has(parsed.id as string)
              )
                continue;
              messages.push(parsed.message);
            }
          } catch (err: unknown) {
            log.debug("skipping malformed JSONL entry", {
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
        rl.close();
      } catch (err: unknown) {
        log.warn("Failed to read entries from JSONL", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { messages: messages as AgentMessageForUI[], customEntries };
  }

  async getFullMessages(
    sessionId: string,
    sessionPath?: string,
    options?: { limit?: number; afterEntryId?: string },
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }> {
    const t0 = performance.now();
    const managed = this.deps.getActiveManaged(sessionId);

    // Resolve session file path first
    const resolvedSessionPath = managed
      ? managed.info.sessionPath
      : this.resolveReadableSessionPath(sessionId, sessionPath);

    // JSONL-first: always read messages directly from the JSONL file.
    // This avoids CLI OOM — CLI's get_full_messages handler uses readFile internally
    // which can blow the heap on large sessions (>8MB JSONL).
    const allMessages: Array<{ entryId: string; message: unknown }> = [];
    const allCustomEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];
    const allCompactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }> = [];
    const parentById: Map<string, string | null> = new Map();
    let lastJsonlLeafPointer: string | null = null;
    // Tracks the deepest/latest entry in JSONL order. Updated on every parsed
    // entry (incl. leaf_pointer). Used to recover the true active leaf when the
    // on-disk leaf_pointer is stale (rollback + continued chat scenario).
    let activeJsonlLeafId: string | null = null;
    const isSandboxSessionPath = resolvedSessionPath?.startsWith("/root/workspace/sessions/");

    if (isSandboxSessionPath) {
      const sandboxManager = this.deps.getSandboxManager();
      if (sandboxManager) {
        try {
          const userId = this.deps._getSandboxUserId(sessionId);
          if (userId) {
            const raw = await sandboxManager.execInSandbox(userId, `cat ${resolvedSessionPath}`);
            const parsed = parseJsonlFromText(raw);
            allMessages.push(...parsed.messages);
            allCustomEntries.push(...parsed.customEntries);
            allCompactionEntries.push(...parsed.compactionEntries);
            for (const [k, v] of parsed.parentById) {
              parentById.set(k, v);
            }
            lastJsonlLeafPointer = parsed.lastLeafPointer;
            activeJsonlLeafId = parsed.activeJsonlLeafId;
          }
        } catch (err: unknown) {
          log.warn("Failed to read sandbox JSONL", {
            sessionPath: resolvedSessionPath,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else if (resolvedSessionPath && existsSync(resolvedSessionPath)) {
      const cached = this.getSessionCache(sessionId, resolvedSessionPath);

      if (cached && !cached.needsIncremental) {
        allMessages.push(...cached.messages);
        allCustomEntries.push(...cached.customEntries);
        allCompactionEntries.push(...cached.compactionEntries);
        for (const [k, v] of cached.parentById) {
          parentById.set(k, v);
        }
        lastJsonlLeafPointer = cached.lastJsonlLeafPointer;
        activeJsonlLeafId = cached.activeJsonlLeafId ?? null;
      } else if (cached && cached.needsIncremental) {
        allMessages.push(...cached.messages);
        allCustomEntries.push(...cached.customEntries);
        allCompactionEntries.push(...cached.compactionEntries);
        for (const [k, v] of cached.parentById) {
          parentById.set(k, v);
        }
        lastJsonlLeafPointer = cached.lastJsonlLeafPointer;
        // Seed from cache; the incremental read advances allMessages in place,
        // so the last entry id (if any) becomes the current deepest leaf.
        activeJsonlLeafId = cached.activeJsonlLeafId ?? null;

        try {
          const incrResult = await this.readJsonlFromByteOffset(
            resolvedSessionPath,
            cached.byteOffset,
            allMessages,
            allCustomEntries,
            parentById,
          );

          for (const ce of incrResult.newCompactionEntries) {
            if (!allCompactionEntries.some((c) => c.entryId === ce.entryId)) {
              allCompactionEntries.push(ce);
            }
          }
          if (incrResult.lastLeafPointer) {
            lastJsonlLeafPointer = incrResult.lastLeafPointer;
          }
          // Incremental read appends to allMessages in place — the last entry
          // id (if any) is the current deepest leaf.
          const incrLast = allMessages[allMessages.length - 1];
          if (incrLast?.entryId) {
            activeJsonlLeafId = incrLast.entryId;
          }

          this.setSessionCache(sessionId, resolvedSessionPath, {
            messages: allMessages,
            customEntries: allCustomEntries,
            compactionEntries: allCompactionEntries,
            parentById,
            lineCount: cached.lineCount + incrResult.totalLines,
            lastJsonlLeafPointer,
            activeJsonlLeafId,
            byteOffset: incrResult.newByteOffset,
          });
        } catch (err: unknown) {
          log.warn("Failed incremental JSONL read, falling back to cache-only", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        try {
          const fullResult = await readJsonlFully(resolvedSessionPath);
          allMessages.push(...fullResult.messages);
          allCustomEntries.push(...fullResult.customEntries);
          allCompactionEntries.push(...fullResult.compactionEntries);
          for (const [k, v] of fullResult.parentById) {
            parentById.set(k, v);
          }
          lastJsonlLeafPointer = fullResult.lastLeafPointer;
          activeJsonlLeafId = fullResult.activeJsonlLeafId;

          this.setSessionCache(sessionId, resolvedSessionPath, {
            messages: allMessages,
            customEntries: allCustomEntries,
            compactionEntries: allCompactionEntries,
            parentById,
            lineCount: fullResult.totalLines,
            lastJsonlLeafPointer,
            activeJsonlLeafId,
          });
        } catch (err: unknown) {
          log.warn("Failed to read entries from JSONL", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Compaction entries were injected into allMessages in-place during JSONL
    // parsing above (preserving chronological order). allCompactionEntries is
    // still used for the streaming merge dedup guard below.

    // Resolve leafId.
    // On-disk leaf_pointer is only written by branch()/resetLeaf() — NOT by
    // normal message appends. So after a rollback + continued chat, the JSONL
    // leaf_pointer still points at the rollback target while newer messages
    // exist as its descendants. activeJsonlLeafId (the last parsed entry) is
    // the true active leaf, mirroring the CLI's _buildIndex "deepest
    // descendant" recovery. Without this, getFullMessages freezes the view at
    // the rollback point and hides all post-rollback messages.
    const inMemoryLeafId = this.deps.leafIds.get(sessionId) ?? null;
    const isStreaming = managed?.info.status === "streaming";
    const leafId =
      (lastJsonlLeafPointer ? (activeJsonlLeafId ?? lastJsonlLeafPointer) : null) ??
      (isStreaming ? (activeJsonlLeafId ?? null) : null) ??
      inMemoryLeafId;
    if (leafId && leafId !== inMemoryLeafId) {
      this.deps.leafIds.set(sessionId, leafId);
    }

    // Build leaf→root path set and filter messages to current branch only.
    let pathIds: Set<string> | null = null;
    if (leafId && parentById.size > 0 && parentById.has(leafId)) {
      pathIds = buildBranchPathSet(leafId, parentById);
    } else if (leafId && parentById.size > 0 && !parentById.has(leafId)) {
      log.warn("[getFullMessages] leafId not found in JSONL, skipping branch filter", {
        sessionId,
        leafId,
        totalEntries: parentById.size,
      });
    }

    const filteredMessages = filterMessagesToBranch(allMessages, pathIds);
    const customEntries = filterCustomEntriesToBranch(allCustomEntries, pathIds);

    // Apply pagination to filtered results.
    let totalCount = filteredMessages.length;
    const paginationResult = applyPagination(filteredMessages, options ?? {});
    const slicedMessages = paginationResult.messages;
    const hasMore = paginationResult.hasMore;
    const nextCursor = paginationResult.nextCursor;

    const totalMs = Math.round(performance.now() - t0);

    // When streaming, JSONL may be incomplete (e.g. toolResult not persisted yet).
    // For remote child runtimes, local JSONL can also remain empty while the
    // active runtime is the authoritative message owner.
    const useCliMemoryAsPrimarySource = allMessages.length === 0;
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
          const jsonlEntryIds = new Set(allMessages.map((m) => m.entryId).filter(Boolean));
          const jsonlUserTexts = new Set(
            allMessages
              .filter((m) => {
                const msg = m.message as Record<string, unknown> | undefined;
                return msg && (msg.role as string) === "user";
              })
              .map((m) => {
                const msg = m.message as { content?: unknown[] };
                if (Array.isArray(msg.content)) {
                  return (msg.content as Array<Record<string, unknown>>)
                    .filter((c) => c.type === "text")
                    .map((c) => (c.text as string) ?? "")
                    .join("");
                }
                return "";
              })
              .filter(Boolean),
          );
          // Build a set of assistant text fingerprints from JSONL for content-based
          // dedup. CLI get_messages() returns AgentMessage[] without entryId, so
          // entryId-based dedup alone misses duplicates.
          const jsonlAssistantTexts = new Set(
            allMessages
              .filter((m) => {
                const msg = m.message as Record<string, unknown> | undefined;
                return msg && (msg.role as string) === "assistant";
              })
              .map((m) => {
                const msg = m.message as { content?: unknown[] };
                if (Array.isArray(msg.content)) {
                  return (msg.content as Array<Record<string, unknown>>)
                    .filter((c) => c.type === "text")
                    .map((c) => (c.text as string) ?? "")
                    .join("");
                }
                return "";
              })
              .filter(Boolean),
          );
          const compactionEntryIds = new Set(allCompactionEntries.map((c) => c.entryId));
          const filteredHasCompaction = filteredMessages.some((fm) => {
            const fmMsg = fm.message as Record<string, unknown>;
            return fmMsg && (fmMsg.role as string) === "compactionSummary";
          });
          for (const msg of memResult) {
            const m = msg as unknown as Record<string, unknown>;
            const eid = (m.entryId as string) ?? "";
            const role = (m.role as string) ?? "";
            if (eid && jsonlEntryIds.has(eid)) continue;
            // compactionSummary is already injected from JSONL in-place; skip CLI
            // memory duplicate. Use entryId-based dedup for precision: only skip
            // if the compaction entry from JSONL is on the current branch.
            if (role === "compactionSummary") {
              if (eid && compactionEntryIds.has(eid)) continue;
              // Also skip if no entryId (CLI-generated in-memory) but JSONL has any
              // compaction on the current filtered branch.
              if (!eid && filteredHasCompaction) continue;
            }
            if (role === "user" && !eid) {
              const content = m.content as unknown[];
              const text = Array.isArray(content)
                ? (content as Array<Record<string, unknown>>)
                    .filter((c) => c.type === "text")
                    .map((c) => (c.text as string) ?? "")
                    .join("")
                : "";
              if (text && jsonlUserTexts.has(text)) continue;
            }
            // Content-based dedup for assistant messages without entryId.
            // CLI get_messages() returns AgentMessage[] that lack entryId, so the
            // entryId check above doesn't catch them. Compare text content instead.
            if (role === "assistant" && !eid) {
              const content = m.content as unknown[];
              const text = Array.isArray(content)
                ? (content as Array<Record<string, unknown>>)
                    .filter((c) => c.type === "text")
                    .map((c) => (c.text as string) ?? "")
                    .join("")
                : "";
              if (text && jsonlAssistantTexts.has(text)) continue;
            }
            slicedMessages.push(m as unknown as AgentMessageForUI);
            if (eid) jsonlEntryIds.add(eid);
          }
          if (useCliMemoryAsPrimarySource) {
            totalCount = Math.max(totalCount, slicedMessages.length);
          }
          perfLog.info("[getFullMessages] memory merge: added from CLI memory", {
            sessionId,
            mergedCount: slicedMessages.length,
          });
        }
      } catch (err: unknown) {
        log.debug("[getMessages] CLI memory merge skipped", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    perfLog.info("[getFullMessages] done", {
      sessionId,
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

  async getTree(sessionId: string): Promise<{ entries: TreeEntry[]; leafId?: string | null }> {
    const managed = this.deps.getActiveManaged(sessionId);
    if (managed) {
      try {
        const result = await withTimeout(managed.client.getTreeWithLeaf(), 15_000, "getTree");
        return {
          entries: Array.isArray(result.entries) ? (result.entries as TreeEntry[]) : [],
          leafId: result.leafId,
        };
      } catch (err: unknown) {
        log.warn("getTree SDK failed, falling back to JSONL", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const sessionPath = this.deps.resolveSessionPath(sessionId);
    if (!sessionPath) throw new Error("Client not found and no session path");
    const entries = await this.readJsonlEntries(sessionPath);
    return {
      entries: entries.map((e) => ({
        id: e.id,
        parentId: e.parentId,
        type: e.type,
        label: e.label,
      })),
      leafId: this.deps.leafIds.get(sessionId) ?? null,
    };
  }

  async navigateTree(
    sessionId: string,
    targetId: string,
    options?: { summarize?: boolean; skipFiles?: boolean },
  ): Promise<{ cancelled: boolean; reason?: string }> {
    const managed = this.deps.getActiveManaged(sessionId);
    if (managed) {
      // Block rollback while agent is actively streaming
      if (managed.info.status === "streaming") {
        log.warn("navigateTree: blocked — agent is streaming", { sessionId, targetId });
        return { cancelled: true, reason: "Agent is streaming" };
      }
      const result = await withTimeout(
        managed.client.navigateTree(targetId, options),
        30_000,
        "navigateTree",
      );
      if (!result.cancelled) {
        this.deps.leafIds.set(sessionId, targetId);
        this.clearSessionCache(sessionId);
        log.info("navigateTree updated leafId", { sessionId, targetId });
      }
      return result;
    }
    log.info("navigateTree: no managed client, applying JSONL fallback", {
      sessionId,
      targetId,
    });

    if (!options?.skipFiles) {
      log.warn("navigateTree: file rollback requires an active CLI process", {
        sessionId,
        targetId,
      });
      return {
        cancelled: true,
        reason:
          "File rollback requires an active agent process. Restart the session and try again.",
      };
    }

    const sessionPath = this.deps.resolveSessionPath(sessionId);
    if (!sessionPath) {
      return { cancelled: true, reason: "No session path found" };
    }

    const entries = await this.readJsonlEntries(sessionPath);
    const exists = entries.some((e) => e.id === targetId);
    if (!exists) {
      return { cancelled: true, reason: "Target entry not found in session" };
    }

    // Compute the actual branch point (skip metadata types, like findBranchPointAbove in CLI SDK).
    // When rolling back a user message, the leaf should point to the ancestor, not the target itself.
    const skipTypes = new Set([
      "custom",
      "agent_change",
      "model_change",
      "thinking_level_change",
      "tier_models_change",
      "custom_message",
      "session_info",
      "segment_summary",
      "deletion",
      "label",
      "leaf_pointer",
      "fold",
    ]);
    const entryById = new Map(entries.map((e: Record<string, unknown>) => [e.id, e]));
    let branchPointId: string | null = targetId;
    const targetEntry = entryById.get(targetId) as Record<string, unknown> | undefined;
    if (targetEntry?.type === "message" && targetEntry?.label === "user") {
      branchPointId = (targetEntry.parentId as string) ?? null;
      while (branchPointId) {
        const ancestor = entryById.get(branchPointId) as Record<string, unknown> | undefined;
        if (!ancestor) break;
        if (!skipTypes.has(ancestor.type as string)) break;
        branchPointId = (ancestor.parentId as string) ?? null;
      }
    }

    this.deps.leafIds.set(sessionId, branchPointId);

    // Write leaf_pointer to JSONL so it survives restart (without active CLI,
    // the SDK's branch() is unavailable, so we append directly).
    try {
      const { appendFile: appendFileAsync } = await import("node:fs/promises");
      const leafPointerEntry = JSON.stringify({
        type: "leaf_pointer",
        id: `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        parentId: null,
        timestamp: new Date().toISOString(),
        leafId: branchPointId,
      });
      await appendFileAsync(sessionPath, `\n${leafPointerEntry}\n`, "utf-8");
    } catch (leafErr: unknown) {
      log.warn("navigateTree: failed to write leaf_pointer in fallback", {
        sessionId,
        err: leafErr instanceof Error ? leafErr.message : String(leafErr),
      });
    }

    log.info("navigateTree: JSONL fallback applied", { sessionId, targetId });
    this.clearSessionCache(sessionId);
    return { cancelled: false };
  }
}
