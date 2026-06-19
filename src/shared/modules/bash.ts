export interface BashProcess {
  toolCallId: string;
  command: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  output: string;
  status: "running" | "done" | "error" | "terminated" | "background";
  error?: string;
  logPath?: string;
}

export interface BashChannelEvent {
  type: "start" | "output" | "end" | "error" | "terminated" | "background" | "list";
  processes?: BashProcess[];
  toolCallId?: string;
  pid?: number;
  data?: string;
  timestamp: number;
}

export interface BashChannelCommand {
  action:
    | "list"
    | "kill"
    | "background"
    | "remove"
    | "subscribe_output"
    | "unsubscribe_output"
    | "write_stdin";
  toolCallId?: string;
  data?: string;
}

export interface BashMethods {
  "bash.list": {
    params: { sessionId: string };
    result: { processes: BashProcess[] };
  };
  "bash.command": {
    params: {
      sessionId: string;
      action:
        | "kill"
        | "background"
        | "remove"
        | "subscribe_output"
        | "unsubscribe_output"
        | "write_stdin";
      toolCallId?: string;
      data?: string;
    };
    result: { ok: boolean };
  };
  "bash.readLog": {
    params: { logPath: string; offset?: number; limit?: number };
    result: { lines: string[]; totalLines: number; hasMore: boolean };
  };
  "bash.watchLog": {
    params: { logPath: string; sessionId?: string };
    result: { watching: boolean };
  };
  "bash.unwatchLog": {
    params: { logPath: string; sessionId?: string };
    result: { stopped: boolean };
  };
}

export interface BashEvents {
  "bash.event": BashEventPayload;
  "bash.logUpdate": BashLogUpdatePayload;
}

export interface BashEventPayload {
  sessionId: string;
  event: BashChannelEvent;
}

export interface BashBackgroundExitEvent {
  customType: "bash_background_process" | "bash_background_exit";
  content: string;
  details: {
    bashId?: string;
    toolCallId?: string;
    pid?: number;
    command: string;
    cwd?: string;
    status?: "done" | "error" | "terminated";
    reason?: "exit_zero" | "exit_nonzero" | "user_cancel" | "system_cancel" | "timeout" | "crash";
    backgroundTrigger?: "auto" | "manual";
    exitCode: number | null;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    duration?: string;
    logPath?: string;
    logPreview?: {
      totalLines: number;
      totalBytes: number;
      truncated: boolean;
      headLineCount: number;
      tailLineCount: number;
      segments: Array<
        | { kind: "line"; text: string; repeatCount?: number }
        | { kind: "omitted"; lineCount: number }
      >;
    };
    error?: string;
  };
  display: "info" | "warning";
}

export interface BashLogUpdatePayload {
  logPath: string;
  newLines: string[];
}
