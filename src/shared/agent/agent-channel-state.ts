import type { BashChannelEvent } from "../modules/bash";
import type { LspChannelEvent } from "../modules/lsp";

export interface CachedLspState {
  state: string;
  servers: unknown[];
  mode?: string;
  activeLanguages?: string[];
}

export function applyBashBackgroundToolState(
  activeBackgroundTools: Set<string>,
  event: BashChannelEvent,
): void {
  if (!event.toolCallId) return;
  if (event.type === "background") {
    activeBackgroundTools.add(event.toolCallId);
  } else if (event.type === "end" || event.type === "error" || event.type === "terminated") {
    activeBackgroundTools.delete(event.toolCallId);
  }
}

export function buildLspLogData(sessionId: string, data: LspChannelEvent): Record<string, unknown> {
  const lspLogData: Record<string, unknown> = {
    sessionId,
    event: data.event,
  };
  if (data.serverName) lspLogData.serverName = data.serverName;
  if (data.totalServers != null) lspLogData.totalServers = data.totalServers;
  if (data.servers?.length) lspLogData.serverCount = data.servers.length;
  if (data.mode) lspLogData.mode = data.mode;
  if (data.languages?.length) lspLogData.languages = data.languages;
  if (data.filePath) lspLogData.filePath = data.filePath;
  if (data.diagnostics) {
    lspLogData.diagnosticsCount = Array.isArray(data.diagnostics)
      ? data.diagnostics.length
      : Object.keys(data.diagnostics).length;
  }
  if (data.error) lspLogData.error = data.error;
  if (data.servers?.length) {
    const anyReady = data.servers.some((s) => s.state === "ready");
    const anyError = data.servers.some((s) => s.state === "error");
    lspLogData.aggregateState = anyReady ? "ready" : anyError ? "error" : "starting";
  }
  return lspLogData;
}

export function deriveLspState(
  current: CachedLspState | undefined,
  data: LspChannelEvent,
): CachedLspState | undefined {
  if (data.event === "startup_complete" || data.event === "status_changed") {
    const servers = (data.servers ?? []) as Array<{
      state?: string;
      status?: { state?: string };
    }>;
    return {
      state: servers.some((s) => s.state === "ready" || s.status?.state === "ready")
        ? "ready"
        : servers.some((s) => s.state === "error" || s.status?.state === "error")
          ? "error"
          : servers.length > 0
            ? "starting"
            : "inactive",
      servers: data.servers ?? [],
      activeLanguages: current?.activeLanguages ?? [],
    };
  }

  if (data.event === "mode_changed" && data.mode && current) {
    return { ...current, mode: data.mode };
  }

  if (data.event === "language_activated" && data.languages?.length && current) {
    return {
      ...current,
      activeLanguages: Array.from(new Set([...(current.activeLanguages ?? []), ...data.languages])),
    };
  }

  return current;
}

export interface MemoryBroadcast {
  name: string;
  payload: Record<string, unknown>;
}

export function createMemoryBroadcast(
  sessionId: string,
  data: Record<string, unknown>,
  timestamp: number,
): MemoryBroadcast | null {
  const eventType = data.type;
  if (typeof eventType !== "string") return null;

  if (eventType === "bookmark_creating") {
    return { name: "memory.bookmark_creating", payload: { sessionId, timestamp } };
  }
  if (eventType === "memory_updated") {
    return { name: "memory.updated", payload: { sessionId, files: data.files, timestamp } };
  }
  if (eventType === "memory_update_failed") {
    return { name: "memory.update_failed", payload: { sessionId, reason: data.reason, timestamp } };
  }
  if (eventType === "memory_irrelevant_marked") {
    return {
      name: "memory.memory_irrelevant_marked",
      payload: { sessionId, ...data, timestamp },
    };
  }
  if (
    eventType === "memory_prefetch" ||
    eventType === "memory_extract" ||
    eventType === "memory_dream" ||
    eventType === "memory_prefetch_result" ||
    eventType === "memory_extract_result" ||
    eventType === "memory_dream_result"
  ) {
    return { name: `memory.${eventType}`, payload: { sessionId, ...data, timestamp } };
  }
  return null;
}

export function createLearningBroadcast(
  sessionId: string,
  data: Record<string, unknown>,
  timestamp: number,
): MemoryBroadcast | null {
  const eventType = data.type;
  if (eventType === "learning.snapshot") {
    return {
      name: "learning.snapshot",
      payload: { sessionId, snapshot: data.snapshot, timestamp },
    };
  }
  if (eventType === "learning.run") {
    return {
      name: "learning.run",
      payload: { sessionId, run: data.run, timestamp },
    };
  }
  if (eventType === "learning.candidate") {
    return {
      name: "learning.candidate",
      payload: { sessionId, candidate: data.candidate, timestamp },
    };
  }
  return null;
}
