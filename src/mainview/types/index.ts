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
};

export type ToolExecutionStatus = "running" | "done" | "error";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; input: string }
  | { type: "toolResult"; toolCallId: string; toolName: string; content: string; isError?: boolean; args?: string; details?: unknown }
  | { type: "toolExecution"; toolCallId: string; toolName: string; args: string; status: ToolExecutionStatus; output?: string; details?: unknown }
  | { type: "custom"; customType: string; data: unknown };

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
  role: "user" | "assistant" | "toolResult" | "custom";
  content: ContentBlock[];
  timestamp: number;
  provider?: string;
  model?: string;
  stopReason?: string | null;
  isStreaming?: boolean;
  tokenUsage?: TokenUsage;
};

export type EditingType = "rename" | "newFile" | "newDir";
export type EditingNode = { path: string; type: EditingType };

export type SessionStatus = "idle" | "streaming" | "compacting" | "permission";

export type ContextUsage = {
  tokens: number | null;
  contextWindow: number;
};

export type SessionMeta = {
  sessionId: string;
  name: string;
  sessionPath: string;
  projectPath: string;
  parentSessionPath: string | null;
  messageCount: number;
  firstMessage: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running";
  sessionStatus?: SessionStatus;
  contextUsage?: ContextUsage;
};

export type RecentProject = {
  path: string;
  name: string;
  lastOpened: number;
  pinned: boolean;
  sessionCount: number;
};

export type PiProject = {
  path: string;
  name: string;
  sessionCount: number;
  lastModified: number;
  hasActiveSession: boolean;
};

export type ConfiguredPath = {
  path: string;
  name: string;
  type: "home" | "documents" | "custom";
};

export type MergedProject = {
  path: string;
  name: string;
  source: "pi" | "recent" | "configured";
  sessionCount: number;
  lastModified: number;
  hasActiveSession: boolean;
};

export type ProjectTab = {
  id: string;
  name: string;
  path: string;
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
  model?: string;
  provider?: string;
  contextUsage?: ContextUsage;
};
