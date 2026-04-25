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
  action: "list" | "kill" | "background";
  toolCallId?: string;
}

export interface BashMethods {
  "bash.list": {
    params: { sessionPath: string };
    result: { processes: BashProcess[] };
  };
  "bash.command": {
    params: { sessionId: string; action: "kill" | "background"; toolCallId?: string };
    result: { ok: boolean };
  };
}

export interface BashEvents {
  "bash.event": BashEventPayload;
}

export interface BashEventPayload {
  sessionId: string;
  event: BashChannelEvent;
}
