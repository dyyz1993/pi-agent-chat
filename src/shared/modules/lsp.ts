export type LspState = "inactive" | "starting" | "ready" | "error";

export interface LspServerStatus {
  name: string;
  fileTypes?: string[];
  state: LspState;
  reason: string;
  transport?: string;
  activeCommand?: string[];
  configuredCommand?: string[];
}

export interface LspChannelEvent {
  event:
    | "status_changed"
    | "diagnostics_update"
    | "mode_changed"
    | "error"
    | "startup_begin"
    | "startup_complete"
    | "server_starting"
    | "server_ready"
    | "server_error"
    | "language_activated";
  timestamp: number;
  servers?: LspServerStatus[];
  diagnostics?: unknown;
  filePath?: string;
  mode?: string;
  error?: string;
  serverName?: string;
  totalServers?: number;
  languages?: string[];
}

export type LspDiagnosticsMode = "agent_end" | "edit_write" | "disabled";

export interface LspMethods {
  "lsp.status": {
    params: { sessionPath: string; sessionId?: string };
    result: { state: LspState; servers: LspServerStatus[]; mode: LspDiagnosticsMode };
  };
  "lsp.setMode": {
    params: { sessionId: string; mode: LspDiagnosticsMode };
    result: { ok: boolean; mode: LspDiagnosticsMode };
  };
}

export interface LspEvents {
  "lsp.event": LspEventPayload;
}

export interface LspEventPayload {
  sessionId: string;
  event: LspChannelEvent;
}
