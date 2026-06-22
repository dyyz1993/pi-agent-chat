import type { AgentEvent as UpstreamAgentEvent } from "@dyyz1993/pi-agent-core";
export interface TreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  label?: string;
}
import type {
  AssistantMessage,
  AssistantMessageEvent,
  TextContent,
  Usage,
  StopReason,
  ToolCall,
  ThinkingContent,
} from "@dyyz1993/pi-ai";
import type { ImageContent } from "@dyyz1993/pi-ai";

export interface AgentMethods {
  "agent.start": {
    params: {
      sessionId: string;
      projectPath: string;
      sessionPath: string;
      forceNewProcess?: boolean;
    };
    result: { agentId: string; status: "started" | "already_running" };
  };
  "agent.replayHoldEvents": {
    params: { sessionId: string };
    result: { replayed: number };
  };
  "agent.send": {
    params: { sessionId: string; content: string; images?: ImageContent[] };
    result: { ok: boolean };
  };
  "agent.stop": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "agent.getStatus": {
    params: { sessionId: string };
    result: { status: "idle" | "streaming" | "stopped"; pid?: number };
  };
  "agent.batchGetSessionsStatus": {
    params: { sessionIds: string[] };
    result: Array<{ sessionId: string; status: "idle" | "streaming" | "stopped" }>;
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
      permissionMode?: string;
      messageCount: number;
      activeToolExecutions: Array<{
        toolCallId: string;
        toolName: string;
        args?: unknown;
        startedAt?: number;
      }>;
      pendingUIRequests?: ExtensionUIRequestEvent[];
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
      tokens: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        total: number;
      };
      cost: number;
      contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
    } | null;
  };
  "agent.getMessages": {
    params: { sessionId: string; sessionPath?: string };
    result: { messages: AgentMessageForUI[]; customEntries: CustomEntryForUI[] };
  };
  "agent.getFullMessages": {
    params: { sessionId: string; sessionPath?: string; limit?: number; afterEntryId?: string };
    result: {
      messages: AgentMessageForUI[];
      customEntries: CustomEntryForUI[];
      hasMore: boolean;
      totalCount: number;
      nextCursor: string | null;
    };
  };
  "agent.steer": {
    params: { sessionId: string; content: string; images?: ImageContent[] };
    result: { ok: boolean };
  };
  "agent.followUp": {
    params: { sessionId: string; content: string; images?: ImageContent[] };
    result: { ok: boolean };
  };
  "agent.abort": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "agent.setCwd": {
    params: { sessionId: string; cwd: string };
    result: { ok: boolean };
  };
  "agent.getAvailableModels": {
    params: { sessionId: string };
    result: Array<{
      provider: string;
      id: string;
      name: string;
      contextWindow: number;
      reasoning: boolean;
      input: ("text" | "image")[];
    }>;
  };
  "agent.setModel": {
    params: { sessionId: string; provider: string; modelId: string };
    result: { provider: string; id: string };
  };
  "agent.switchTier": {
    params: { sessionId: string; tier: "fast" | "pro" | "max" };
    result: { provider: string; id: string; tier: "fast" | "pro" | "max" };
  };
  "agent.cycleModel": {
    params: { sessionId: string };
    result: {
      model: { provider: string; id: string };
      thinkingLevel: string;
      isScoped: boolean;
    } | null;
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
  "agent.setPermissionMode": {
    params: { sessionId: string; mode: string };
    result: { mode: string };
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
    result: {
      extensions: Array<{
        path: string;
        resolvedPath: string;
        toolNames: string[];
        commandNames: string[];
      }>;
    };
  };
  "agent.getSkills": {
    params: { sessionId: string };
    result: {
      skills: Array<{
        name: string;
        description: string;
        filePath: string;
        baseDir: string;
        disableModelInvocation: boolean;
      }>;
    };
  };
  "agent.getDisabledSkills": {
    params: Record<string, never>;
    result: { disabledSkills: string[] };
  };
  "agent.setDisabledSkill": {
    params: { skillName: string; disabled: boolean };
    result: { disabledSkills: string[] };
  };
  "agent.getDisabledPlugins": {
    params: { projectPath: string };
    result: { disabledPlugins: string[] };
  };
  "agent.setDisabledPlugin": {
    params: { projectPath: string; pluginPath: string; disabled: boolean };
    result: { disabledPlugins: string[] };
  };
  "agent.getTools": {
    params: { sessionId: string };
    result: { tools: Array<{ name: string; label: string; description: string }> };
  };
  "agent.getMcpServers": {
    params: { sessionId: string };
    result: {
      servers: Array<{
        name: string;
        status: "connecting" | "connected" | "error" | "disconnected";
        error?: string;
        tools: Array<{
          originalName: string;
          fullName: string;
          description: string;
        }>;
        scope: "global" | "project";
        disabled?: boolean;
      }>;
    };
  };
  "agent.toggleMcpServer": {
    params: { sessionId: string; name: string; enabled: boolean };
    result: { success: boolean; error?: string };
  };
  "agent.restartMcpServer": {
    params: { sessionId: string; name: string };
    result: { success: boolean; error?: string };
  };
  "agent.reload": {
    params: { sessionId: string };
    result: void;
  };
  "agent.getContextUsage": {
    params: { sessionId: string };
    result: {
      tokens: number | null;
      contextWindow: number;
      percent: number | null;
      breakdown?: Array<{
        id:
          | "system_base"
          | "tools"
          | "mcp_tools"
          | "context_files"
          | "skills"
          | "agents"
          | "tool_inputs"
          | "tool_outputs"
          | "conversation"
          | "thinking"
          | "memory"
          | "rules"
          | "lsp"
          | "provider_system"
          | "provider_messages"
          | "provider_tools"
          | "provider_options"
          | "unclassified";
        label: string;
        tokens: number;
        source: "core" | "extension";
        estimated: boolean;
        details?: Array<{ label: string; tokens: number }>;
        compaction?: {
          count: number;
          tokensBefore: number;
          summaryTokens: number;
          estimatedSavedTokens: number;
        };
      }>;
      providerRequest?: {
        version: 1;
        provider: string;
        modelId: string;
        api?: string;
        timestamp: string;
        payloadChars: number;
        payloadTokens: number;
        topLevelKeys: string[];
        sections: Array<{
          id: "system" | "messages" | "tools" | "options";
          label: string;
          chars: number;
          tokens: number;
          count?: number;
        }>;
        toolDefinitions?: Array<{
          name: string;
          chars: number;
          tokens: number;
        }>;
        toolInteractions?: Array<{
          name: string;
          inputCount: number;
          inputChars: number;
          inputTokens: number;
          avgInputTokens: number;
          outputCount: number;
          outputChars: number;
          outputTokens: number;
          avgOutputTokens: number;
        }>;
      };
    };
  };
  "agent.getTierModels": {
    params: { sessionId: string };
    result: { models: Record<string, string> };
  };
  "agent.setTierModels": {
    params: { sessionId: string; models: Record<string, string> };
    result: { ok: boolean };
  };
  "agent.getSettings": {
    params: { sessionId: string; scope?: string };
    result: Record<string, unknown>;
  };
  "agent.setSettings": {
    params: { sessionId: string; settings: Record<string, unknown>; scope?: string };
    result: { ok: boolean };
  };
  "agent.getProjectTrust": {
    params: { projectPath: string };
    result: {
      projectPath: string;
      trusted: boolean;
      decision: boolean | null;
      decisionPath?: string;
      trustStorePath: string;
    };
  };
  "agent.setProjectTrust": {
    params: { projectPath: string; trusted: boolean };
    result: {
      projectPath: string;
      trusted: boolean;
      decision: boolean;
      decisionPath: string;
      trustStorePath: string;
    };
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
    params: { sessionId: string; entryId: string; position?: "before" | "at" };
    result: { text: string; cancelled: boolean; newSessionFile?: string; newSessionId?: string };
  };
  "agent.navigateTree": {
    params: { sessionId: string; targetId: string; summarize?: boolean; skipFiles?: boolean };
    result: { cancelled: boolean; reason?: string };
  };
  "agent.previewRollback": {
    params: { sessionId: string; targetId: string };
    result: { restored: string[]; deleted: string[] };
  };
  "agent.getModifiedFiles": {
    params: {
      sessionId: string;
      fromEntryId?: string;
      toEntryId?: string;
      toUserMsgEntryId?: string;
    };
    result: {
      files: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        turnIndex: number;
        entryId: string;
      }>;
      resolvedFromEntryId: string | null;
    };
  };
  "agent.getFileDiff": {
    params: {
      sessionId: string;
      filePath: string;
      fromEntryId?: string;
      toEntryId?: string;
    };
    result: {
      path: string;
      oldContent: string | null;
      newContent: string | null;
      unifiedDiff: string;
    } | null;
  };
  "agent.getBatchDiffs": {
    params: { sessionId: string; fromEntryId?: string; toEntryId?: string };
    result: {
      files: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        diff: {
          path: string;
          oldContent: string | null;
          newContent: string | null;
          unifiedDiff: string;
        } | null;
      }>;
      summary: { totalFiles: number; added: number; modified: number; deleted: number };
    };
  };
  "agent.getTree": {
    params: { sessionId: string };
    result: { entries: TreeEntry[] };
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
  "agent.getAgents": {
    params: { sessionId: string };
    result: {
      agents: Array<{
        name: string;
        description?: string;
        tier?: string;
        tools?: string[];
        permissionMode?: string;
        source: string;
        filePath: string;
        color?: string;
        avatar?: { type: "emoji"; value: string } | { type: "image"; src: string };
      }>;
    };
  };
  "agent.switchAgent": {
    params: { sessionId: string; agentName: string };
    result: {
      agentName: string;
      tools: string[];
      tier?: string;
      thinkingLevel?: string;
    };
  };
  "agent.getCurrentAgent": {
    params: { sessionId: string };
    result: { agentName: string | null };
  };
  "agent.getAgentDetail": {
    params: { sessionId: string; agentName: string };
    result: {
      agent: {
        name: string;
        description: string;
        tools?: string[];
        disallowedTools?: string[];
        model?: string;
        systemPrompt: string;
        source: string;
        filePath: string;
        permissionMode?: string;
        maxTurns?: number;
        effort?: string;
        color?: string;
        background?: boolean;
        memory?: string;
        isolation?: string;
        initialPrompt?: string;
        skills?: string[];
        hooks?: Record<string, unknown>;
        variables?: Record<string, string>;
        tier?: string;
        thinkingLevel?: string;
        mode?: string;
        hidden?: boolean;
        avatar?: { type: "emoji"; value: string } | { type: "image"; src: string };
      };
    };
  };
  "agent.getAllTools": {
    params: { sessionId: string };
    result: {
      tools: Array<{
        name: string;
        description?: string;
        sourceInfo?: unknown;
      }>;
    };
  };
  "agent.getSystemPrompt": {
    params: { sessionId: string };
    result: { systemPrompt: string; appendSystemPrompt?: string[] };
  };
  "agent.getLatestAgentChange": {
    params: { sessionId: string };
    result: {
      agentName: string;
      agentConfig?: {
        description?: string;
        tools?: string[];
        permissionMode?: string;
        tier?: string;
        thinkingLevel?: string;
        model?: string;
      };
      timestamp: string;
    } | null;
  };
}

export interface AgentMessageForUI {
  role: string;
  content: (TextContent | ThinkingContent | ToolCall)[];
  usage?: Usage;
  stopReason?: StopReason;
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
  "agent.session_status_changed": { sessionId: string; projectPath: string; status: string };
  "agent.session_renamed": { sessionId: string; projectPath: string; newName: string };
}

export interface AgentEventPayload {
  sessionId: string;
  event: AgentEvent;
}

/** Batch of agent events sent together to reduce broadcast overhead. */
export interface AgentBatchEventPayload {
  sessionId: string;
  events: AgentEvent[];
}

export interface ChannelDataEvent {
  type: "channel_data";
  name: string;
  data: Record<string, unknown>;
}

export interface HookMeta {
  toolName: string;
  matcher: string;
  description?: string;
  command?: string;
  hookCommand?: string;
  eventName?: string;
  source?: string;
  reason: string;
  confirmText?: string;
  cancelText?: string;
}

export type PermissionMeta =
  | {
      type: "path_boundary" | "dangerous_bash" | "hook_approval";
      path: string;
      cwd: string;
      toolName: string;
      scope: "read" | "write";
      relativeTo: string;
    }
  | {
      type: "permission_runtime";
      requestId: string;
      provider: string;
      subject: string;
      toolCallId?: string;
      metadata?: Record<string, unknown>;
    };

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestion {
  id: string;
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionAnswer {
  selected: string[];
  text?: string;
}

export interface ExtensionUIRequestEvent {
  type: "extension_ui_request";
  id: string;
  method:
    | "askUserQuestion"
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text";
  title?: string;
  message?: string;
  options?: string[];
  questions?: AskUserQuestion[];
  multiple?: boolean;
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  toolCallId?: string;
  confirmText?: string;
  cancelText?: string;
  hookMeta?: HookMeta;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  widgetKey?: string;
  widgetLines?: string[];
  widgetPlacement?: "aboveEditor" | "belowEditor";
  text?: string;
  permissionMeta?: PermissionMeta;
}

export interface ExtensionUIResolvedEvent {
  type: "extension_ui_resolved";
  id: string;
  reason: "responded" | "timeout" | "aborted";
}

export interface CompactionResult {
  tokensAfter?: number;
  tokensBefore?: number;
}

export type AgentEvent =
  | UpstreamAgentEvent
  | { type: "compaction_start"; reason: string }
  | { type: "compaction_end"; reason: string; result: CompactionResult; aborted: boolean }
  | { type: "queue_update"; steering: string[]; followUp: string[] }
  | ExtensionUIRequestEvent
  | ExtensionUIResolvedEvent
  | ChannelDataEvent
  | { type: "custom_entry"; customType: string; data: unknown; id: string; display?: boolean }
  | { type: "session_rename"; oldName: string | undefined; newName: string }
  | { type: "session_info_changed"; name: string }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
  | { type: "extension_llm_error"; error: string; source?: string }
  | {
      type: "mcp_connection_change";
      name: string;
      status: "connecting" | "connected" | "error" | "disconnected";
      error?: string;
      tools: Array<{ originalName: string; fullName: string; description: string }>;
    };

export type { AssistantMessage, AssistantMessageEvent, TextContent };

export interface AgentProcessInfo {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  status: "idle" | "streaming";
  activeToolExecutions?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    startedAt?: number;
  }>;
}
