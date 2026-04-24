export type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
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
  | { type: "toolResult"; toolCallId: string; toolName: string; content: string; isError?: boolean }
  | { type: "toolExecution"; toolCallId: string; toolName: string; args: string; status: ToolExecutionStatus; output?: string };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "toolResult";
  content: ContentBlock[];
  timestamp: number;
  provider?: string;
  model?: string;
  stopReason?: string | null;
  isStreaming?: boolean;
  tokenUsage?: { input: number; output: number };
};

export type EditingType = "rename" | "newFile" | "newDir";
export type EditingNode = { path: string; type: EditingType };

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
