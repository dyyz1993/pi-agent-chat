import { create } from "zustand";
import type { LspServerStatus, LspDiagnosticsMode, LspChannelEvent } from "../../shared/modules/lsp";
import { apiClient } from "../lib/api-client";

interface RawLspServerFromChannel {
  name: string;
  fileTypes?: string[];
  state?: string;
  reason?: string;
  status?: { state?: string; reason?: string; transport?: string; activeCommand?: string[]; configuredCommand?: string[] };
}

interface ServerStartupLog {
  name: string;
  state: "starting" | "ready" | "error";
  fileTypes?: string[];
  timestamp: number;
}

interface LspState {
  statusBySession: Record<string, {
    state: "inactive" | "starting" | "ready" | "error";
    servers: LspServerStatus[];
    mode: LspDiagnosticsMode;
    lastDiagnostics?: { filePath: string; count: number; timestamp: number };
    startupLog: ServerStartupLog[];
    totalServers?: number;
    startupComplete?: boolean;
    activeLanguages: string[];
  }>;

  updateStatus: (sessionId: string, update: Partial<LspState["statusBySession"][string]>) => void;
  handleLspEvent: (sessionId: string, event: LspChannelEvent) => void;
  loadHistory: (sessionPath: string, sessionId: string) => Promise<void>;
  setMode: (sessionId: string, mode: LspDiagnosticsMode) => void;
  clearSession: (sessionId: string) => void;
}

export const useLspStore = create<LspState>()((set, get) => ({
  statusBySession: {},

  updateStatus: (sessionId, update) => {
    set((s) => {
      const existing = s.statusBySession[sessionId] || { state: "inactive" as const, servers: [], mode: "agent_end" as const, startupLog: [], activeLanguages: [] };
      return {
        statusBySession: {
          ...s.statusBySession,
          [sessionId]: { ...existing, ...update },
        },
      };
    });
  },

  handleLspEvent: (sessionId, event) => {
    const store = get();
    const getServerState = (s: RawLspServerFromChannel) => s.status?.state ?? s.state ?? "inactive";

    switch (event.event) {
      case "startup_begin":
        store.updateStatus(sessionId, {
          state: "starting",
          servers: [],
          startupLog: (event.servers as RawLspServerFromChannel[]).map((s) => ({
            name: s.name,
            state: "starting" as const,
            fileTypes: s.fileTypes,
            timestamp: event.timestamp,
          })),
          totalServers: event.totalServers,
          startupComplete: false,
          activeLanguages: [],
        });
        break;
      case "server_starting":
      case "server_ready":
      case "server_error": {
        const srvState = event.event === "server_ready" ? "ready" as const : event.event === "server_error" ? "error" as const : "starting" as const;
        const logEntry: ServerStartupLog = {
          name: event.serverName ?? "unknown",
          state: srvState,
          fileTypes: undefined,
          timestamp: event.timestamp,
        };
        const srvData = event.servers?.[0] as RawLspServerFromChannel | undefined;
        if (srvData) logEntry.fileTypes = srvData.fileTypes;

        const current = store.statusBySession[sessionId];
        if (current) {
          const updatedLog = [...current.startupLog];
          const existingIdx = updatedLog.findIndex((l) => l.name === logEntry.name);
          if (existingIdx >= 0) {
            updatedLog[existingIdx] = logEntry;
          } else {
            updatedLog.push(logEntry);
          }
          const updatedServers = [...current.servers];
          const srvIdx = updatedServers.findIndex((s) => s.name === (event.serverName ?? "unknown"));
          if (srvIdx >= 0) {
            updatedServers[srvIdx] = { ...updatedServers[srvIdx], state: srvState };
          } else {
            updatedServers.push({
              name: event.serverName ?? "unknown",
              state: srvState,
              reason: srvData?.status?.reason ?? "",
              fileTypes: srvData?.fileTypes,
            });
          }
          const hasReady = updatedServers.some((s) => s.state === "ready");
          const hasError = updatedServers.some((s) => s.state === "error");
          const hasStarting = updatedServers.some((s) => s.state === "starting");
          const newState = hasReady ? "ready" as const : hasError ? "error" as const : hasStarting ? "starting" as const : current.state;
          store.updateStatus(sessionId, { startupLog: updatedLog, servers: updatedServers, state: newState });
        }
        break;
      }
      case "startup_complete":
      case "status_changed": {
        const rawServers = (event.servers ?? []) as RawLspServerFromChannel[];
        const servers: LspServerStatus[] = rawServers.map((s) => ({
          name: s.name,
          fileTypes: s.fileTypes,
          state: getServerState(s) as LspServerStatus["state"],
          reason: s.status?.reason ?? s.reason ?? "",
          transport: (s.status as Record<string, unknown>)?.transport as string | undefined,
          activeCommand: (s.status as Record<string, unknown>)?.activeCommand as string[] | undefined,
          configuredCommand: (s.status as Record<string, unknown>)?.configuredCommand as string[] | undefined,
        }));
        const hasReady = servers.some((s) => s.state === "ready");
        const hasError = servers.some((s) => s.state === "error");
        const hasStarting = servers.some((s) => s.state === "starting");
        const state = hasReady ? "ready"
          : hasError ? "error"
          : hasStarting ? "starting"
          : "inactive";
        const activeLanguages = Array.from(new Set(servers.filter((s) => s.state === "ready").flatMap((s) => s.fileTypes ?? [])));
        store.updateStatus(sessionId, {
          state,
          servers,
          startupComplete: true,
          startupLog: [],
          activeLanguages,
        });
        break;
      }
      case "mode_changed":
        if (event.mode) {
          store.updateStatus(sessionId, { mode: event.mode as LspDiagnosticsMode });
        }
        break;
      case "diagnostics_update":
        if (event.filePath) {
          const diagnostics = event.diagnostics;
          const count = Array.isArray(diagnostics) ? diagnostics.length : 0;
          store.updateStatus(sessionId, {
            lastDiagnostics: { filePath: event.filePath, count, timestamp: event.timestamp },
          });
        }
        break;
      case "error":
        store.updateStatus(sessionId, { state: "error", startupComplete: true });
        break;
      case "language_activated": {
        const langs = event.languages ?? [];
        const serverName = event.serverName;
        if (langs.length > 0 || serverName) {
          const current = store.statusBySession[sessionId];
          const existingLangs = current?.activeLanguages ?? [];
          const mergedLangs = langs.length > 0 ? Array.from(new Set([...existingLangs, ...langs])) : existingLangs;
          const updatedServers = current?.servers ? [...current.servers] : [];
          if (serverName) {
            const idx = updatedServers.findIndex((s) => s.name === serverName);
            if (idx >= 0) {
              updatedServers[idx] = { ...updatedServers[idx], state: "starting" as const };
            }
          }
          const hasReady = updatedServers.some((s) => s.state === "ready");
          const hasStarting = updatedServers.some((s) => s.state === "starting");
          const newState = hasReady ? "ready" as const : hasStarting ? "starting" as const : current?.state ?? "inactive";
          store.updateStatus(sessionId, { activeLanguages: mergedLangs, servers: updatedServers, state: newState });
        }
        break;
      }
    }
  },

  loadHistory: async (sessionPath, sessionId) => {
    try {
      const current = get().statusBySession[sessionId];
      if (current && current.state !== "inactive" && current.startupComplete) {
        // skipped - already loaded
        return;
      }

      const result = await apiClient.call("lsp.status", { sessionPath, sessionId });
      const data = result as { state: string; servers: LspServerStatus[]; mode: string };
      if (data.state === "inactive" && data.servers.length === 0) {
        // returning early - inactive+empty
        return;
      }

      const liveState = get().statusBySession[sessionId];
      if (liveState && liveState.state !== "inactive" && liveState.startupComplete) return;

      const activeLanguages = Array.from(new Set(data.servers.filter((s) => s.state === "ready").flatMap((s) => s.fileTypes ?? [])));
      get().updateStatus(sessionId, {
        state: data.state as LspState["statusBySession"][string]["state"],
        servers: data.servers,
        mode: (data.mode ?? "agent_end") as LspDiagnosticsMode,
        startupComplete: true,
        startupLog: [],
        activeLanguages,
      });
    } catch { }
  },

  setMode: (sessionId, mode) => {
    get().updateStatus(sessionId, { mode });
    apiClient.call("lsp.setMode", { sessionId, mode }).catch(() => { });
  },

  clearSession: (sessionId) => {
    set((s) => {
      const updated = { ...s.statusBySession };
      delete updated[sessionId];
      return { ...s, statusBySession: updated };
    });
  },
}));
