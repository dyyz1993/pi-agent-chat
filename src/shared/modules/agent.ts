import type { AgentEvent as UpstreamAgentEvent } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, TextContent } from "@dyyz1993/pi-ai";

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
  "agent.getState": {
    params: { sessionId: string };
    result: {
      model?: {
        id: string;
        contextWindow: number;
        maxTokens: number;
      };
      isStreaming: boolean;
      isCompacting: boolean;
      messageCount: number;
    } | null;
  };
  "agent.getSessionStats": {
    params: { sessionId: string };
    result: {
      tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
      cost: number;
      contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
    } | null;
  };
}

export interface AgentEvents {
  "agent.event": AgentEventPayload;
}

export interface AgentEventPayload {
  sessionId: string;
  event: AgentEvent;
}

export interface ChannelDataEvent {
  type: "channel_data";
  name: string;
  data: unknown;
}

export interface ExtensionUIRequestEvent {
  type: "extension_ui_request";
  id: string;
  method: "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle" | "set_editor_text";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: "aboveEditor" | "belowEditor";
  text?: string;
}

export interface ResponseEvent {
  type: "response";
  id: string;
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export type AgentEvent =
  | UpstreamAgentEvent
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; result: unknown; aborted: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | ResponseEvent
  | ExtensionUIRequestEvent
  | ChannelDataEvent;

export type { AssistantMessage, AssistantMessageEvent, TextContent };

export type MessageData = AssistantMessage;

export interface AgentProcessInfo {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  pid: number;
  status: "idle" | "streaming";
  holdEvents: AgentEvent[];
  holdStartTime: number;
}
