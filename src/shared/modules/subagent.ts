export interface SubagentSessionInfo {
  toolCallId?: string;
  sessionId: string;
  sessionPath: string;
  description: string;
  instruction: string;
  systemPrompt?: string;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  finalText?: string;
  error?: string;
}

export interface SubagentMethods {
  "subagent.listBySession": {
    params: { sessionPath: string };
    result: { subsessions: SubagentSessionInfo[] };
  };
  "subagent.rename": {
    params: { parentSessionPath: string; subSessionId: string; newDescription: string };
    result: { ok: boolean };
  };
  "subagent.delete": {
    params: { parentSessionPath: string; subSessionId: string };
    result: { ok: boolean };
  };
}

export interface SubagentEvents {
  "subagent.event": SubagentEventPayload;
}

export interface SubagentEventPayload {
  parentSessionId: string;
  parentSessionPath?: string;
  subSessionId: string;
  event: SubagentStreamEvent;
}

export type SubagentStreamEvent =
  | { type: "subagent_start"; description: string; instruction: string }
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "message_start"; message: Record<string, unknown> }
  | { type: "message_update"; message: Record<string, unknown> }
  | { type: "message_end"; message: Record<string, unknown> }
  | {
      type: "tool_execution_start";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; result: unknown; aborted: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: string; [key: string]: unknown };
