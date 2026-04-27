import type { AgentEvent as UpstreamAgentEvent } from "@dyyz1993/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, TextContent } from "@dyyz1993/pi-ai";

export interface AgentMethods {
  "agent.start": {
    params: { sessionId: string; projectPath: string; sessionPath: string };
    result: { agentId: string; status: "started" | "already_running" };
  };
  "agent.replayHoldEvents": {
    params: { sessionId: string };
    result: { replayed: number };
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
        name?: string;
        api?: string;
        provider?: string;
        reasoning?: boolean;
        contextWindow: number;
        maxTokens: number;
      };
      thinkingLevel?: string;
      isStreaming: boolean;
      isCompacting: boolean;
      steeringMode?: string;
      followUpMode?: string;
      messageCount: number;
    } | null;
  };
  "agent.getCommands": {
    params: { sessionId: string };
    result: Array<{
      name: string;
      description: string;
      source: "extension" | "prompt" | "skill";
    }>;
  };
  "agent.getSessionStats": {
    params: { sessionId: string };
    result: {
      tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
      cost: number;
      contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
    } | null;
  };
  "agent.getMessages": {
    params: { sessionId: string };
    result: { messages: AgentMessageForUI[]; customEntries: CustomEntryForUI[] };
  };
  "agent.steer": {
    params: { sessionId: string; content: string };
    result: { ok: boolean };
  };
  "agent.followUp": {
    params: { sessionId: string; content: string };
    result: { ok: boolean };
  };
  "agent.abort": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "agent.getAvailableModels": {
    params: { sessionId: string };
    result: Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>;
  };
  "agent.setModel": {
    params: { sessionId: string; provider: string; modelId: string };
    result: { provider: string; id: string };
  };
  "agent.cycleModel": {
    params: { sessionId: string };
    result: { model: { provider: string; id: string }; thinkingLevel: string; isScoped: boolean } | null;
  };
  "agent.setThinkingLevel": {
    params: { sessionId: string; level: string };
    result: { ok: boolean };
  };
  "agent.cycleThinkingLevel": {
    params: { sessionId: string };
    result: { level: string } | null;
  };
  "agent.compact": {
    params: { sessionId: string; customInstructions?: string };
    result: { summary: string; tokensBefore: number };
  };
  "agent.setAutoCompaction": {
    params: { sessionId: string; enabled: boolean };
    result: { ok: boolean };
  };
  "agent.setAutoRetry": {
    params: { sessionId: string; enabled: boolean };
    result: { ok: boolean };
  };
  "agent.abortRetry": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "agent.setSteeringMode": {
    params: { sessionId: string; mode: string };
    result: { ok: boolean };
  };
  "agent.setFollowUpMode": {
    params: { sessionId: string; mode: string };
    result: { ok: boolean };
  };
  "agent.getActiveTools": {
    params: { sessionId: string };
    result: { toolNames: string[] };
  };
  "agent.setActiveTools": {
    params: { sessionId: string; toolNames: string[] };
    result: { ok: boolean };
  };
  "agent.getQueue": {
    params: { sessionId: string };
    result: { steering: string[]; followUp: string[] };
  };
  "agent.clearQueue": {
    params: { sessionId: string };
    result: { steering: string[]; followUp: string[] };
  };
  "agent.getExtensions": {
    params: { sessionId: string };
    result: { extensions: Array<{ path: string; resolvedPath: string; toolNames: string[]; commandNames: string[] }> };
  };
  "agent.getSkills": {
    params: { sessionId: string };
    result: { skills: Array<{ name: string; description: string; filePath: string; baseDir: string; disableModelInvocation: boolean }> };
  };
  "agent.getTools": {
    params: { sessionId: string };
    result: { tools: Array<{ name: string; label: string; description: string }> };
  };
  "agent.getContextUsage": {
    params: { sessionId: string };
    result: { tokens: number | null; contextWindow: number; percent: number | null };
  };
  "agent.getSettings": {
    params: { sessionId: string; scope?: string };
    result: Record<string, unknown>;
  };
  "agent.setSettings": {
    params: { sessionId: string; settings: Record<string, unknown>; scope?: string };
    result: { ok: boolean };
  };
  "agent.setSessionName": {
    params: { sessionId: string; name: string };
    result: { ok: boolean };
  };
  "agent.getLastAssistantText": {
    params: { sessionId: string };
    result: { text: string | null };
  };
  "agent.getForkMessages": {
    params: { sessionId: string };
    result: { messages: Array<{ entryId: string; text: string }> };
  };
  "agent.fork": {
    params: { sessionId: string; entryId: string };
    result: { text: string; cancelled: boolean };
  };
  "agent.clone": {
    params: { sessionId: string };
    result: { cancelled: boolean };
  };
  "agent.newSession": {
    params: { sessionId: string; parentSession?: string };
    result: { cancelled: boolean };
  };
  "agent.exportHtml": {
    params: { sessionId: string; outputPath?: string };
    result: { path: string };
  };
}

export interface AgentMessageForUI {
  role: string;
  content: unknown[];
  usage?: unknown;
  stopReason?: string;
  provider?: string;
  model?: string;
  id?: string;
  timestamp?: string;
}

export interface CustomEntryForUI {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
}

export interface AgentEvents {
  "agent.event": AgentEventPayload;
  "agent.notify": { sessionId: string; message: string; notifyType: "info" | "warning" | "error" };
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

export type AgentEvent =
  | UpstreamAgentEvent
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; result: unknown; aborted: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | ExtensionUIRequestEvent
  | ChannelDataEvent
  | { type: "custom_entry"; customType: string; data: unknown; id: string }
  | { type: "session_rename"; oldName: string | undefined; newName: string };

export type { AssistantMessage, AssistantMessageEvent, TextContent };

export type MessageData = AssistantMessage;

export interface AgentProcessInfo {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  status: "idle" | "streaming";
  holdEvents: unknown[];
}
