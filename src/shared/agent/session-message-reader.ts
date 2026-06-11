import { existsSync, statSync } from "fs";
import { createReadStream } from "fs";
import * as readline from "readline";
import { performance } from "perf_hooks";

import type { AgentMessageForUI } from "../modules/agent";
import type { TreeEntry } from "../modules/agent";
import { createLogger } from "../lib/logger";

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
      byteOffset: number;
    }
  >();
  private static SESSION_CACHE_MAX = 10;

  constructor(deps: SessionMessageReaderDeps) {
    this.deps = deps;
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
   */
  async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
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
      if (lineIndex <= startLine) continue; // skip already-parsed lines
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const entryId = (parsed.id as string) ?? "";
        const parentId = (parsed.parentId as string | null | undefined) ?? null;
        if (entryId) {
          parentById.set(entryId, parentId);
        }
        if (parsed.type === "message" && parsed.message) {
          messages.push({ entryId, message: parsed.message });
          newEntries++;
        } else if (parsed.type === "custom") {
          customEntries.push({
            id: entryId || `custom-${Date.now()}`,
            customType: (parsed.customType as string) ?? "unknown",
            data: parsed.data,
            timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
          });
          newEntries++;
        } else if (parsed.type === "compaction") {
          messages.push({
            entryId,
            message: {
              role: "compactionSummary",
              summary: (parsed.summary as string) ?? "",
              tokensBefore: parsed.tokensBefore as number | undefined,
              timestamp: new Date(
                (parsed.timestamp as string | number | Date) ?? 0,
              ).getTime(),
            },
          });
          newEntries++;
        }
      } catch {
        // skip malformed
      }
    }
    rl.close();
    return { newEntries, totalLines: lineIndex };
  }

  /**
   * Read JSONL from a specific byte offset onwards. Unlike readJsonlFromLine
   * which skips lines one-by-one, this uses createReadStream({ start }) for
   * O(1) seek. Also collects compaction and leaf_pointer entries in one pass.
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
    let lineIndex = 0;
    let newEntries = 0;
    const newCompactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }> = [];
    let lastLeafPointer: string | null = null;

    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8", start: byteOffset }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      lineIndex++;
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const entryId = (parsed.id as string) ?? "";
        const parentId = (parsed.parentId as string | null | undefined) ?? null;
        if (entryId) {
          parentById.set(entryId, parentId);
        }
        if (parsed.type === "message" && parsed.message) {
          messages.push({ entryId, message: parsed.message });
          newEntries++;
        } else if (parsed.type === "custom") {
          customEntries.push({
            id: entryId || `custom-${Date.now()}`,
            customType: (parsed.customType as string) ?? "unknown",
            data: parsed.data,
            timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
          });
          newEntries++;
        } else if (parsed.type === "compaction") {
          const compEntry = {
            entryId,
            summary: (parsed.summary as string) ?? "",
            tokensBefore: parsed.tokensBefore as number | undefined,
            timestamp: new Date(
              (parsed.timestamp as string | number | Date) ?? 0,
            ).getTime(),
          };
          newCompactionEntries.push(compEntry);
          messages.push({
            entryId,
            message: {
              role: "compactionSummary",
              summary: compEntry.summary,
              tokensBefore: compEntry.tokensBefore,
              timestamp: compEntry.timestamp,
            },
          });
          newEntries++;
        } else if (parsed.type === "leaf_pointer" && typeof parsed.leafId === "string") {
          lastLeafPointer = parsed.leafId;
        }
      } catch {
        // skip malformed
      }
    }
    rl.close();
    let newByteOffset = byteOffset;
    try {
      newByteOffset = statSync(sessionPath).size;
    } catch {
      // file gone — keep original offset
    }
    return { newEntries, totalLines: lineIndex, newByteOffset, newCompactionEntries, lastLeafPointer };
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
    const entries: Array<{
      id: string;
      parentId: string | null;
      type: string;
      customType?: string;
      label?: string;
    }> = [];
    if (!sessionPath || !existsSync(sessionPath)) return entries;
    try {
      const rl = readline.createInterface({
        input: createReadStream(sessionPath, { encoding: "utf-8" }),
        crlfDelay: Infinity,
      });
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (parsed.id && parsed.type) {
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
              id: parsed.id as string,
              parentId: (parsed.parentId as string | null | undefined) ?? null,
              type: parsed.type as string,
              customType: parsed.customType as string | undefined,
              label,
            });
          }
        } catch (err: unknown) {
          log.warn("readJsonlEntries: skipping malformed entry", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
      rl.close();
    } catch (err: unknown) {
      log.warn("readJsonlEntries: failed to read file", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
    return entries;
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
      resolvedSessionPath = this.deps.resolveSessionPath(sessionId) ?? sessionPath ?? "";
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
            const raw = await sandboxManager.execInSandbox(
              userId,
              `cat ${resolvedSessionPath}`,
            );
            const lines = raw.split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line) as Record<string, unknown>;
                if (parsed.type === "custom") {
                  if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id))
                    continue;
                  customEntries.push({
                    id: (parsed.id as string) ?? `custom-${Date.now()}`,
                    customType: (parsed.customType as string) ?? "unknown",
                    data: parsed.data,
                    timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                  });
                } else if (parsed.type === "compaction") {
                  if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id))
                    continue;
                  messages.push({
                    id: parsed.id,
                    role: "compactionSummary",
                    summary: parsed.summary ?? "",
                    tokensBefore: parsed.tokensBefore,
                    timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                  });
                } else if (parsed.type === "message" && parsed.message) {
                  if (activePathIds && typeof parsed.id === "string" && !activePathIds.has(parsed.id))
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
      : this.deps.resolveSessionPath(sessionId) ?? sessionPath ?? "";

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
    const isSandboxSessionPath = resolvedSessionPath?.startsWith("/root/workspace/sessions/");

    if (isSandboxSessionPath) {
      const sandboxManager = this.deps.getSandboxManager();
      if (sandboxManager) {
        try {
          const userId = this.deps._getSandboxUserId(sessionId);
          if (userId) {
            const raw = await sandboxManager.execInSandbox(
              userId,
              `cat ${resolvedSessionPath}`,
            );
            const lines = raw.split("\n");
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line) as Record<string, unknown>;
                const entryId = (parsed.id as string) ?? "";
                const parentId = (parsed.parentId as string | null | undefined) ?? null;
                if (entryId) {
                  parentById.set(entryId, parentId);
                }
                if (parsed.type === "custom") {
                  allCustomEntries.push({
                    id: entryId || `custom-${Date.now()}`,
                    customType: (parsed.customType as string) ?? "unknown",
                    data: parsed.data,
                    timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                  });
                } else if (parsed.type === "message" && parsed.message) {
                  allMessages.push({
                    entryId,
                    message: parsed.message,
                  });
                } else if (parsed.type === "compaction") {
                  allCompactionEntries.push({
                    entryId,
                    summary: (parsed.summary as string) ?? "",
                    tokensBefore: parsed.tokensBefore as number | undefined,
                    timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                  });
                  // Inject in-place to preserve JSONL chronological order
                  allMessages.push({
                    entryId,
                    message: {
                      role: "compactionSummary",
                      summary: (parsed.summary as string) ?? "",
                      tokensBefore: parsed.tokensBefore as number | undefined,
                      timestamp: new Date(
                        (parsed.timestamp as string | number | Date) ?? 0,
                      ).getTime(),
                    },
                  });
                } else if (parsed.type === "leaf_pointer" && typeof parsed.leafId === "string") {
                  lastJsonlLeafPointer = parsed.leafId;
                }
              } catch (err: unknown) {
                log.debug("skipping malformed JSONL entry (sandbox)", {
                  err: err instanceof Error ? err.message : String(err),
                });
              }
            }
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
      } else if (cached && cached.needsIncremental) {
        allMessages.push(...cached.messages);
        allCustomEntries.push(...cached.customEntries);
        allCompactionEntries.push(...cached.compactionEntries);
        for (const [k, v] of cached.parentById) {
          parentById.set(k, v);
        }
        lastJsonlLeafPointer = cached.lastJsonlLeafPointer;

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

          this.setSessionCache(sessionId, resolvedSessionPath, {
            messages: allMessages,
            customEntries: allCustomEntries,
            compactionEntries: allCompactionEntries,
            parentById,
            lineCount: cached.lineCount + incrResult.totalLines,
            lastJsonlLeafPointer,
            byteOffset: incrResult.newByteOffset,
          });
        } catch (err: unknown) {
          log.warn("Failed incremental JSONL read, falling back to cache-only", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        try {
          let lineCount = 0;
          const rl = readline.createInterface({
            input: createReadStream(resolvedSessionPath, { encoding: "utf-8" }),
            crlfDelay: Infinity,
          });
          for await (const line of rl) {
            if (!line.trim()) continue;
            lineCount++;
            try {
              const parsed = JSON.parse(line) as Record<string, unknown>;
              const entryId = (parsed.id as string) ?? "";
              const parentId = (parsed.parentId as string | null | undefined) ?? null;
              if (entryId) {
                parentById.set(entryId, parentId);
              }
              if (parsed.type === "custom") {
                allCustomEntries.push({
                  id: entryId || `custom-${Date.now()}`,
                  customType: (parsed.customType as string) ?? "unknown",
                  data: parsed.data,
                  timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                });
              } else if (parsed.type === "message" && parsed.message) {
                allMessages.push({
                  entryId,
                  message: parsed.message,
                });
              } else if (parsed.type === "compaction") {
                allCompactionEntries.push({
                  entryId,
                  summary: (parsed.summary as string) ?? "",
                  tokensBefore: parsed.tokensBefore as number | undefined,
                  timestamp: new Date((parsed.timestamp as string | number | Date) ?? 0).getTime(),
                });
                allMessages.push({
                  entryId,
                  message: {
                    role: "compactionSummary",
                    summary: (parsed.summary as string) ?? "",
                    tokensBefore: parsed.tokensBefore as number | undefined,
                    timestamp: new Date(
                      (parsed.timestamp as string | number | Date) ?? 0,
                    ).getTime(),
                  },
                });
              } else if (parsed.type === "leaf_pointer" && typeof parsed.leafId === "string") {
                lastJsonlLeafPointer = parsed.leafId;
              }
            } catch (err: unknown) {
              log.debug("skipping malformed JSONL entry", {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
          rl.close();

          this.setSessionCache(sessionId, resolvedSessionPath, {
            messages: allMessages,
            customEntries: allCustomEntries,
            compactionEntries: allCompactionEntries,
            parentById,
            lineCount,
            lastJsonlLeafPointer,
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

    // Resolve leafId: prefer JSONL leaf_pointer (authoritative on-disk value),
    // fall back to in-memory cache (may be stale after process kill)
    const leafId = lastJsonlLeafPointer ?? this.deps.leafIds.get(sessionId) ?? null;
    if (leafId && leafId !== this.deps.leafIds.get(sessionId)) {
      this.deps.leafIds.set(sessionId, leafId);
    }

    // Build leaf→root path set and filter messages to current branch only.
    let filteredMessages = allMessages;
    let customEntries = allCustomEntries;
    if (leafId && parentById.size > 0 && parentById.has(leafId)) {
      const pathIds = new Set<string>();
      let curId: string | null = leafId;
      while (curId) {
        pathIds.add(curId);
        const parent = parentById.get(curId);
        curId = parent ?? null;
      }
      filteredMessages = allMessages.filter((m) => pathIds.has(m.entryId));
      // Exclude compaction_fold/snip — they are internal compaction metadata
      // (50万+ entries in large sessions) that the frontend does not use.
      const COMPACTION_CUSTOM_TYPES = new Set(["compaction_fold", "compaction_snip"]);
      customEntries = allCustomEntries.filter(
        (e) => pathIds.has(e.id) && !COMPACTION_CUSTOM_TYPES.has(e.customType),
      );
    } else if (leafId && parentById.size > 0 && !parentById.has(leafId)) {
      log.warn("[getFullMessages] leafId not found in JSONL, skipping branch filter", {
        sessionId,
        leafId,
        totalEntries: parentById.size,
      });
    }

    // Apply pagination to filtered results. Without a cursor this returns the
    // newest page. With afterEntryId, return the page immediately before that
    // entry so the UI can prepend older history without loading the full JSONL.
    const totalCount = filteredMessages.length;
    const limit = options?.limit;
    const afterEntryId = options?.afterEntryId;
    let hasMore = false;
    let nextCursor: string | null = null;

    let slicedMessages: unknown[];
    const injectEntryId = (e: { entryId: string; message: unknown }) => {
      const msg = e.message as Record<string, unknown>;
      if (msg && typeof msg === "object" && e.entryId) {
        return { ...msg, entryId: e.entryId };
      }
      return msg;
    };
    const cursorIndex =
      afterEntryId != null
        ? filteredMessages.findIndex((entry) => entry.entryId === afterEntryId)
        : -1;

    if (afterEntryId != null && cursorIndex < 0) {
      log.warn("[getFullMessages] afterEntryId not found, returning empty page", {
        sessionId,
        afterEntryId,
        totalCount,
      });
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

    const totalMs = Math.round(performance.now() - t0);

    // When streaming, JSONL may be incomplete (e.g. toolResult not persisted yet).
    // Merge in-memory messages from CLI to supplement the JSONL data.
    if (managed && managed.info.status === "streaming") {
      try {
        const memResult = await withTimeout(
          managed.client.getMessages(),
          5_000,
          "getMessages (streaming merge)",
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
            slicedMessages.push(m as unknown as AgentMessageForUI);
            if (eid) jsonlEntryIds.add(eid);
          }
          perfLog.info("[getFullMessages] streaming merge: added from CLI memory", {
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

    if (!options?.skipFiles) {
      log.warn("navigateTree: file restore skipped (no active CLI process)", {
        sessionId,
        targetId,
      });
    }

    log.info("navigateTree: JSONL fallback applied", { sessionId, targetId });
    this.clearSessionCache(sessionId);
    return { cancelled: false };
  }
}
