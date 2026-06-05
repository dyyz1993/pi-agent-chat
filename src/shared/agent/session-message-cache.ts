import { createReadStream, statSync } from "fs";
import * as readline from "readline";

export interface SessionMessageEntry {
  entryId: string;
  message: unknown;
}

export interface SessionCustomEntry {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
}

export interface SessionCacheData {
  messages: SessionMessageEntry[];
  customEntries: SessionCustomEntry[];
  parentById: Map<string, string | null>;
  lineCount: number;
}

interface CachedSessionData extends SessionCacheData {
  fileSize: number;
  mtimeMs: number;
}

export interface SessionCacheHit extends SessionCacheData {
  needsIncremental: boolean;
}

export class SessionMessageCache {
  private cache = new Map<string, CachedSessionData>();

  constructor(private readonly maxEntries = 10) {}

  /**
   * Three outcomes:
   * 1. Exact match (file unchanged) -> return cached data
   * 2. File grew -> return cached data + mark for incremental append
   * 3. No cache / file shrunk / file gone -> return null
   */
  get(sessionId: string, sessionPath: string): SessionCacheHit | null {
    const cached = this.cache.get(sessionId);
    if (!cached) return null;

    try {
      const stats = statSync(sessionPath);
      if (stats.size === cached.fileSize && stats.mtimeMs === cached.mtimeMs) {
        this.touch(sessionId, cached);
        return { ...cached, needsIncremental: false };
      }
      if (stats.size > cached.fileSize) {
        this.touch(sessionId, cached);
        return { ...cached, needsIncremental: true };
      }
    } catch {
      // file gone or inaccessible
    }

    this.cache.delete(sessionId);
    return null;
  }

  set(sessionId: string, sessionPath: string, data: SessionCacheData): void {
    try {
      const stats = statSync(sessionPath);
      if (this.cache.size >= this.maxEntries) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      this.cache.set(sessionId, {
        ...data,
        fileSize: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    } catch {
      // file gone - don't cache
    }
  }

  clear(sessionId?: string): void {
    if (sessionId) {
      this.cache.delete(sessionId);
      return;
    }
    this.cache.clear();
  }

  async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: SessionMessageEntry[],
    customEntries: SessionCustomEntry[],
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
        }
      } catch {
        // skip malformed
      }
    }
    rl.close();

    return { newEntries, totalLines: lineIndex };
  }

  private touch(sessionId: string, cached: CachedSessionData): void {
    this.cache.delete(sessionId);
    this.cache.set(sessionId, cached);
  }
}
