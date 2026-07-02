// 权威定义在 src/shared/modules/project.ts，前端 re-export 保持单一来源。
// RPC schema 与 store 共享同一个 SessionStatus，避免两端漂移。
import type {
  SessionStatus as SharedSessionStatus,
  SessionMeta as SharedSessionMeta,
  ProjectRuntime as SharedProjectRuntime,
  RemoteProjectRef as SharedRemoteProjectRef,
} from "../../shared/modules/project";
import type { AskUserQuestion } from "../../shared/modules/agent";
export type SessionStatus = SharedSessionStatus;

// 以下类型权威定义在 shared/modules/project.ts，前端 re-export 保持单一来源。
export type {
  RecentProject,
  PiProject,
  MergedProject,
  FavoriteFolder,
  DirectoryEntry,
  ProjectRuntime,
  RemoteProjectRef,
  RemoteProjectRecord,
  RemoteResourceSyncPreview,
  RemoteSyncResourceType,
  SshRuntimeKind,
  SshProfile,
  DetectedSshHost,
  SshDirectoryEntry,
  SshConnectionErrorCode,
} from "../../shared/modules/project";
export type SessionMeta = SharedSessionMeta & {
  sessionStatus?: SessionStatus;
  contextUsage?: ContextUsage;
};

export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  isIgnored?: boolean;
  children?: TreeNode[];
  expanded?: boolean;
  loaded?: boolean;
};

export type DemoMethod = "system.ping" | "system.hello" | "system.echo";

export type FilePreview = {
  path: string;
  name: string;
  content: string | null;
  imageUrl: string | null;
  mimeType: string;
  size: number;
  isText: boolean;
  isImage: boolean;
  totalLines?: number;
  editable?: boolean;
};

export type ToolExecutionStatus = "running" | "done" | "error" | "background" | "unknown";

export type UIMethod = "askUserQuestion" | "confirm" | "select" | "input" | "editor" | "notify";

export type UIInteractionStatus = "pending" | "responded" | "dismissed" | "notified";

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
      actions?: Array<"allow_once" | "always_allow_project" | "deny_once" | "always_deny_project">;
      rememberOptions?: Array<{
        id: string;
        label: string;
        subject: string;
        pattern: string;
        scope: "project" | "session";
        action: "allow" | "deny";
        metadata?: Record<string, unknown>;
      }>;
      toolCallId?: string;
      metadata?: Record<string, unknown>;
    };

export type UIInteractionBlock = {
  type: "uiInteraction";
  id: string;
  method: UIMethod;
  status: UIInteractionStatus;
  toolName?: string;
  title?: string;
  message?: string;
  options?: string[];
  questions?: AskUserQuestion[];
  multiple?: boolean;
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
  response?: Record<string, unknown>;
  respondedAt?: number;
  sessionId?: string;
  hookMeta?: {
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
  };
  permissionMeta?: PermissionMeta;
  timeout?: number;
  confirmText?: string;
  cancelText?: string;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; input: string }
  | {
      type: "toolResult";
      toolCallId: string;
      toolName: string;
      content: string;
      isError?: boolean;
      args?: string;
      details?: unknown;
    }
  | {
      type: "toolExecution";
      toolCallId: string;
      toolName: string;
      args: string;
      status: ToolExecutionStatus;
      output?: string;
      details?: unknown;
      timeout?: number;
      startedAt?: number;
      endedAt?: number;
      description?: string;
    }
  | { type: "custom"; customType: string; data: unknown }
  | {
      type: "compactionSummary";
      summary: string;
      tokensBefore?: number;
      status?: "running" | "completed" | "failed" | "aborted";
      reason?: string;
      startedAt?: number;
    }
  | { type: "imageBlock"; url: string; alt?: string }
  | UIInteractionBlock;

export type TokenUsage = {
  input: number;
  output: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult" | "custom" | "compactionSummary" | "error";
  content: ContentBlock[];
  timestamp: number;
  provider?: string;
  model?: string;
  stopReason?: string | null;
  isStreaming?: boolean;
  tokenUsage?: TokenUsage;
  entryId?: string;
  _local?: boolean;
};

export type Turn = {
  id: string;
  userMessageId: string | null;
  assistantMessageIds: string[];
  index: number;
  timestamp: number;
  tokenUsage?: TokenUsage;
};

export type EditingType = "rename" | "newFile" | "newDir";
export type EditingNode = { path: string; type: EditingType };

export type ContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent?: number | null;
  breakdown?: ContextUsageBreakdownItem[];
  providerRequest?: ProviderRequestContextUsage;
};

export type SessionUsageStats = {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  toolCalls: number;
  totalMessages: number;
  userMessages?: number;
  assistantMessages?: number;
  toolResults?: number;
  contextUsage?: ContextUsage;
};

export type ProviderRequestContextUsage = {
  version: 1;
  provider: string;
  modelId: string;
  api?: string;
  timestamp: string;
  payloadChars: number;
  payloadTokens: number;
  topLevelKeys: string[];
  sections: ProviderRequestContextUsageSection[];
  toolDefinitions?: ProviderRequestToolDefinitionUsage[];
  toolInteractions?: ProviderRequestToolInteractionUsage[];
};

export type ProviderRequestContextUsageSection = {
  id: "system" | "messages" | "tools" | "options";
  label: string;
  chars: number;
  tokens: number;
  count?: number;
};

export type ProviderRequestToolDefinitionUsage = {
  name: string;
  chars: number;
  tokens: number;
};

export type ProviderRequestToolInteractionUsage = {
  name: string;
  inputCount: number;
  inputChars: number;
  inputTokens: number;
  avgInputTokens: number;
  outputCount: number;
  outputChars: number;
  outputTokens: number;
  avgOutputTokens: number;
};

export type ContextUsageBreakdownId =
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

export type ContextUsageBreakdownItem = {
  id: ContextUsageBreakdownId;
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
};

export type ConfiguredPath = {
  path: string;
  name: string;
  type: "home" | "documents" | "custom";
};

export type ProjectTab = {
  id: string;
  name: string;
  path: string;
  runtime?: SharedProjectRuntime;
  remote?: SharedRemoteProjectRef;
  active?: boolean;
  connected?: boolean;
};

export type SubagentSessionInfo = {
  toolCallId?: string;
  sessionId: string;
  sessionPath: string;
  description: string;
  instruction: string;
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  finalText?: string;
  error?: string;
  agent?: string;
  provider?: string;
  model?: string;
  contextUsage?: ContextUsage;
};

export type SnapshotInfo = {
  id: string;
  stepIndex: number;
  timestamp: string;
  treeHash: string;
  diff: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  files: Record<string, string>;
  rolledBack: boolean;
};

// ─── Turn-based Timeline Types ───

/** A single item within a Turn */
export type TimelineItem =
  | { itemType: "userMessage"; messageId: string; text: string; timestamp: number }
  | { itemType: "assistantText"; blockIndex: number; text: string; messageId: string }
  | {
      itemType: "toolExecution";
      blockIndex: number;
      toolCallId: string;
      toolName: string;
      args: string;
      status: ToolExecutionStatus;
      output?: string;
      details?: unknown;
      messageId: string;
    }
  | {
      itemType: "customEntry";
      entryId: string;
      customType: string;
      data: unknown;
      timestamp: number;
    };

/** A "Turn" = one user message + the assistant's full response (text blocks + tool executions) */
export type TimelineTurn = {
  id: string;
  index: number;
  userMessageId: string | null;
  userEntryId: string | null;
  userText: string;
  userTimestamp: number;
  assistantMessageId: string | null;
  assistantEntryId: string | null;
  items: TimelineItem[];
  model?: string;
  provider?: string;
  tokenUsage?: TokenUsage;
  isStreaming: boolean;
  collapsed: boolean;
};

/** Standalone custom entry not bound to any Turn (e.g., memory prefetch, system actions) */
export type StandaloneEntry = {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
  icon?: string;
  label?: string;
  color?: string;
};

/** Batch operation types */
export type BatchAction =
  | { type: "delete" }
  | { type: "rollbackCode"; snapshotIds: string[] }
  | { type: "rollbackChat"; targetItemId: string };
