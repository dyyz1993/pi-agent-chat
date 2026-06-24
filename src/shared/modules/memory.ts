export interface MemoryFile {
  filename: string;
  filePath: string;
  description: string | null;
  type: "user" | "feedback" | "project" | "reference" | "bookmark" | null;
  mtimeMs: number;
  size?: number;
}

export interface MemoryMethods {
  "memory.listFiles": {
    params: { projectPath: string; sessionId?: string };
    result: { files: MemoryFile[]; entrypointContent: string | null; memoryDir: string };
  };
  "memory.readFile": {
    params: { filePath: string };
    result: { content: string; size: number };
  };
  "memory.deleteFile": {
    params: { filePath: string };
    result: { ok: boolean };
  };
  "memory.remember": {
    params: { projectPath: string; sessionId: string; messageIds: string[]; content: string };
    result: { ok: boolean };
  };
  "memory.markIrrelevant": {
    params: { sessionId: string; query: string; selectedFiles: string[] };
    result: { ok: boolean };
  };
  "memory.getStatus": {
    params: { sessionId: string };
    result: MemoryStatusResult;
  };
  "memory.removeRule": {
    params: {
      sessionId: string;
      rule?: { pattern: string; mode: string };
      excludeKeyword?: string;
    };
    result: { ok: boolean };
  };
  "memory.addRule": {
    params: { sessionId: string; pattern: string; mode: string; action: string };
    result: { ok: boolean };
  };
}

export interface MemoryEventData {
  sessionId: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface PrefetchHistoryEntry {
  query: string;
  selected: string[];
  skipped: boolean;
  skip_hits: string[];
  guard_hits: string[];
  timestamp: number;
}

export interface MemoryStatusResult {
  skipRules: {
    builtin: Array<{ pattern: string; mode: string }>;
    custom: Array<{ pattern: string; mode: string }>;
  };
  guardRules: {
    builtin: Array<{ pattern: string; mode: string }>;
    custom: Array<{ pattern: string; mode: string }>;
  };
  excludeKeywords: string[];
  recentQueries: PrefetchHistoryEntry[];
  dream: {
    lastRunAt: number | null;
  };
}

export interface MemoryEvents {
  "memory.bookmark_creating": { sessionId: string; timestamp: number };
  "memory.creating": { sessionId: string; sourceMessageIds: string[]; timestamp: number };
  "memory.updated": { sessionId: string; files: MemoryFile[]; timestamp: number };
  "memory.update_failed": { sessionId: string; reason: string; timestamp: number };
  "memory.memory_prefetch": MemoryEventData;
  "memory.memory_prefetch_result": MemoryEventData;
  "memory.memory_extract": MemoryEventData;
  "memory.memory_extract_result": MemoryEventData;
  "memory.memory_dream": MemoryEventData;
  "memory.memory_dream_result": MemoryEventData;
  "memory.memory_irrelevant_marked": MemoryEventData;
}
