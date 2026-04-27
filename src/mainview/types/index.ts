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

export type Turn = {
  id: string;
  userMessageId: string | null;
  assistantMessageIds: string[];
  index: number;
  timestamp: number;
  tokenUsage?: TokenUsage;
};

export type TurnSelection = {
  selectedTurnIds: Set<string>;
  totalTokens: number;
  messageCount: number;
};

export type CollapseState = Record<string, boolean>;

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
  pinned?: boolean;
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
	provider?: string;
	model?: string;
	contextUsage?: ContextUsage;
};

export type BookmarkEntry = {
	id: string;
	filename: string;
	filePath: string;
	title: string;
	description: string;
	summary: string;
	tags: string[];
	sourceSessionId: string;
	sourceMessageIds: string[];
	sourcePreview: string;
	mtimeMs: number;
	size: number;
};

export type FileDiffEntry = {
  path: string;
  status: "added" | "modified" | "deleted";
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
  | { itemType: "toolExecution"; blockIndex: number; toolCallId: string; toolName: string; args: string; status: ToolExecutionStatus; output?: string; details?: unknown; messageId: string }
  | { itemType: "customEntry"; entryId: string; customType: string; data: unknown; timestamp: number };

/** A "Turn" = one user message + the assistant's full response (text blocks + tool executions) */
export type TimelineTurn = {
  id: string;
  index: number;
  userMessageId: string | null;
  userText: string;
  userTimestamp: number;
  assistantMessageId: string | null;
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

/** Selection state for batch operations */
export type SelectionState = {
  selectedItems: Set<string>; // itemId keys
  selectedTurns: Set<string>; // turnId keys
  mode: "none" | "items" | "turns";
};

/** Batch operation types */
export type BatchAction =
  | { type: "delete" }
  | { type: "rollbackCode"; snapshotIds: string[] }
  | { type: "rollbackChat"; targetItemId: string };
