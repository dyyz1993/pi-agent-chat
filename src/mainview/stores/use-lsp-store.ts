import { create } from "zustand";
import type { LspServerStatus, LspDiagnosticsMode, LspChannelEvent } from "../../shared/modules/lsp";
import { apiClient } from "../lib/api-client";

interface RawLspServerFromChannel {
  name: string;
  fileTypes?: string[];
  state?: string;
  status?: { state?: string };
  reason?: string;
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
      const existing = s.statusBySession[sessionId] || { state: "inactive" as const, servers: [], mode: "agent_end" as const, startupLog: [] };
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
    switch (event.event) {
      case "startup_begin":
        store.updateStatus(sessionId, {
          state: "starting",
          servers: [],
          startupLog: (event.servers as RawLspServerFromChannel[]).map((s) => ({
            name: s.name,
            state: "starting",
            fileTypes: s.fileTypes,
            timestamp: event.timestamp,
          })),
          totalServers: event.totalServers,
          startupComplete: false,
        });
        break;
      case "server_starting":
      case "server_ready":
      case "server_error": {
        const logEntry: ServerStartupLog = {
          name: event.serverName!,
          state: event.event === "server_ready" ? "ready" : event.event === "server_error" ? "error" : "starting",
          fileTypes: undefined,
          timestamp: event.timestamp,
        };
        const srvData = event.servers?.[0] as LspServerStatus | undefined;
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
          store.updateStatus(sessionId, { startupLog: updatedLog });
        }
        break;
      }
      case "startup_complete":
        store.updateStatus(sessionId, {
          state: (event.servers?.some((s: RawLspServerFromChannel) => s.state === "ready") ? "ready"
            : event.servers?.some((s: RawLspServerFromChannel) => s.state === "error") ? "error"
              : "inactive"),
          servers: (event.servers ?? []) as LspServerStatus[],
          startupComplete: true,
        });
        break;
      case "status_changed":
        store.updateStatus(sessionId, {
          state: (event.servers?.some((s: RawLspServerFromChannel) => s.state === "ready") ? "ready"
            : event.servers?.some((s: RawLspServerFromChannel) => s.state === "error") ? "error"
              : event.servers?.length ? "starting" : "inactive"),
          servers: (event.servers ?? []) as LspServerStatus[],
          startupComplete: true,
        });
        break;
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
    }
  },

  loadHistory: async (sessionPath, sessionId) => {
    try {
      const result = await apiClient.call("lsp.status", { sessionPath });
      const data = result as { state: string; servers: LspServerStatus[]; mode: string };
      get().updateStatus(sessionId, {
        state: data.state as LspState["statusBySession"][string]["state"],
        servers: data.servers,
        mode: (data.mode ?? "agent_end") as LspDiagnosticsMode,
        startupComplete: true,
        startupLog: data.servers.map((s) => ({
          name: s.name,
          state: s.state as "ready" | "error" | "starting",
          fileTypes: s.fileTypes,
          timestamp: Date.now(),
        })),
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
