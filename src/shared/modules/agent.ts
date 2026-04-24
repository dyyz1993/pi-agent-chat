export interface AgentMethods {
  "agent.start": {
    params: { sessionId: string; projectPath: string; sessionPath: string };
    result: { agentId: string; status: "started" | "already_running" };
  };
  "agent.send": {
    params: { sessionId: string; content: string };
    result: { ok: boolean };
  };
  "agent.stop": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "agent.status": {
    params: { sessionId: string };
    result: { status: "idle" | "streaming" | "stopped"; pid?: number };
  };
  "agent.respondUI": {
    params: { sessionId: string; requestId: string; response: Record<string, unknown> };
    result: { ok: boolean };
  };
}

export interface AgentEvents {
  "agent.event": AgentEventPayload;
}

export interface AgentEventPayload {
  sessionId: string;
  event: AgentEvent;
}

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: unknown; toolResults: unknown[] }
  | { type: "message_start"; message: MessageData }
  | { type: "message_update"; message: MessageData; assistantMessageEvent?: unknown }
  | { type: "message_end"; message: MessageData }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; args: Record<string, unknown>; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; result: unknown; aborted: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | { type: "response"; id: string; command: string; success: boolean; data?: unknown; error?: string }
  | { type: "extension_ui_request"; id: string; method: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

export interface MessageData {
  role: string;
  content?: ContentBlock[];
  provider?: string;
  model?: string;
  usage?: unknown;
  stopReason?: string | null;
  timestamp?: number;
}

export interface ContentBlock {
  type: "text" | "thinking" | "toolCall";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: string;
}

export interface AgentProcessInfo {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  pid: number;
  status: "idle" | "streaming";
  holdEvents: AgentEvent[];
  holdStartTime: number;
}
