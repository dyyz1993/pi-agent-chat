import {
  Eye,
  Pencil,
  Search,
  Code,
  Terminal,
  Image as ImageIcon,
  Wrench,
  FolderOpen,
  GitBranch,
  Globe,
  Database,
  Cpu,
  Bot,
  User,
  Network,
  FileText,
  Video,
  Music,
  File,
  Brain,
  Activity,
  CircleCheckBig,
  ListChecks,
  TextCursorInput,
  FileCode2,
  Bell,
  Zap,
  ListTodo,
  FileCode,
  type LucideIcon,
} from "lucide-react";
import { ALL_MEMORY_TYPES } from "./memory-config";

export type ToolIconEntry = {
  icon: LucideIcon;
  color: string;
  label: string;
};

const TOOL_ICON_MAP: Record<string, ToolIconEntry> = {
  subagent: { icon: Bot, color: "text-semantic-agent", label: "SubAgent" },
  read: { icon: Eye, color: "text-status-info", label: "Read" },
  edit: { icon: Pencil, color: "text-status-success", label: "Edit" },
  write: { icon: Pencil, color: "text-status-success", label: "Write" },
  search: { icon: Search, color: "text-status-warning", label: "Search" },
  grep: { icon: Search, color: "text-status-warning", label: "Grep" },
  glob: { icon: Search, color: "text-status-warning", label: "Glob" },
  code: { icon: Code, color: "text-semantic-agent", label: "Code" },
  terminal: { icon: Terminal, color: "text-semantic-tool", label: "Terminal" },
  bash: { icon: Terminal, color: "text-semantic-tool", label: "Bash" },
  image: { icon: ImageIcon, color: "text-pink-400", label: "Image" },
  folder: { icon: FolderOpen, color: "text-status-warning", label: "Folder" },
  git: { icon: GitBranch, color: "text-semantic-notify", label: "Git" },
  web: { icon: Globe, color: "text-status-info", label: "Web" },
  fetch: { icon: Globe, color: "text-status-info", label: "Fetch" },
  db: { icon: Database, color: "text-semantic-memory", label: "Database" },
  mcp: { icon: Cpu, color: "text-semantic-agent", label: "MCP" },
  lsp: { icon: Network, color: "text-status-info", label: "LSP" },
  lsp_health: { icon: Network, color: "text-status-info", label: "LSP Health" },
  lsp_exec: { icon: FileCode, color: "text-semantic-tool", label: "LSP Exec" },
  todo: { icon: ListTodo, color: "text-status-warning", label: "Todo" },
  preview: { icon: Eye, color: "text-status-success", label: "Preview" },
  ui_confirm: { icon: CircleCheckBig, color: "text-status-success", label: "确认" },
  ui_select: { icon: ListChecks, color: "text-status-info", label: "选择" },
  ui_input: { icon: TextCursorInput, color: "text-status-warning", label: "输入" },
  ui_editor: { icon: FileCode2, color: "text-semantic-agent", label: "编辑" },
  ui_notify: { icon: Bell, color: "text-semantic-tool", label: "通知" },
  ui_respond: { icon: Zap, color: "text-semantic-notify", label: "响应注入" },
};

const DEFAULT_ENTRY: ToolIconEntry = {
  icon: Wrench,
  color: "text-gray-400",
  label: "Tool",
};

const PREVIEW_TYPE_ICON_MAP: Record<string, ToolIconEntry> = {
  image: { icon: ImageIcon, color: "text-pink-400", label: "Image" },
  url: { icon: Globe, color: "text-status-info", label: "URL" },
  html: { icon: Code, color: "text-semantic-notify", label: "HTML" },
  pdf: { icon: FileText, color: "text-status-error", label: "PDF" },
  video: { icon: Video, color: "text-semantic-agent", label: "Video" },
  audio: { icon: Music, color: "text-semantic-tool", label: "Audio" },
  markdown: { icon: File, color: "text-status-warning", label: "Markdown" },
  text: { icon: FileText, color: "text-gray-400", label: "Text" },
};

export function getPreviewResourceIcon(resourceType: string): ToolIconEntry {
  return (
    PREVIEW_TYPE_ICON_MAP[resourceType.toLowerCase()] ??
    PREVIEW_TYPE_ICON_MAP["text"] ??
    DEFAULT_ENTRY
  );
}

const USER_ENTRY: ToolIconEntry = {
  icon: User,
  color: "text-semantic-accent",
  label: "User",
};

const ASSISTANT_ENTRY: ToolIconEntry = {
  icon: Bot,
  color: "text-status-success",
  label: "Assistant",
};

export function getToolIcon(toolName: string): ToolIconEntry {
  const key = toolName.toLowerCase();
  for (const [k, v] of Object.entries(TOOL_ICON_MAP)) {
    if (key.includes(k)) return v;
  }
  return DEFAULT_ENTRY;
}

const CUSTOM_TYPE_ICON_MAP: Record<string, ToolIconEntry> = {
  ...Object.fromEntries(
    Object.entries(ALL_MEMORY_TYPES).map(([key, cfg]) => [
      key,
      { icon: cfg.icon, color: cfg.color, label: cfg.label },
    ]),
  ),
  lsp_diagnostics: { icon: Network, color: "text-status-warning", label: "LSP Diagnostics" },
  bash_background_exit: { icon: Terminal, color: "text-semantic-tool", label: "Background Exit" },
  step_snapshot: { icon: Activity, color: "text-gray-400", label: "Step Snapshot" },
};

const UI_METHOD_ICON_MAP: Record<string, ToolIconEntry> = {
  confirm: { icon: CircleCheckBig, color: "text-status-success", label: "确认" },
  select: { icon: ListChecks, color: "text-status-info", label: "选择" },
  input: { icon: TextCursorInput, color: "text-status-warning", label: "输入" },
  editor: { icon: FileCode2, color: "text-semantic-agent", label: "编辑" },
  notify: { icon: Bell, color: "text-semantic-tool", label: "通知" },
  respondUI: { icon: Zap, color: "text-semantic-notify", label: "响应注入" },
};

export function getUIMethodIcon(method: string): ToolIconEntry {
  return UI_METHOD_ICON_MAP[method] ?? DEFAULT_ENTRY;
}

const CUSTOM_TYPE_DEFAULT: ToolIconEntry = {
  icon: Brain,
  color: "text-semantic-agent",
  label: "Custom",
};

export function getCustomTypeIcon(customType: string): ToolIconEntry {
  return CUSTOM_TYPE_ICON_MAP[customType] ?? CUSTOM_TYPE_DEFAULT;
}

export function getRoleIcon(role: "user" | "assistant" | "toolResult" | "custom"): ToolIconEntry {
  switch (role) {
    case "user":
      return USER_ENTRY;
    case "assistant":
      return ASSISTANT_ENTRY;
    case "toolResult":
      return DEFAULT_ENTRY;
    case "custom":
      return CUSTOM_TYPE_DEFAULT;
  }
}

export function getMessageIcon(message: {
  role: string;
  content: Array<{ type: string; name?: string; toolName?: string; customType?: string }>;
}): ToolIconEntry {
  if (message.role === "user") return getRoleIcon("user");
  if (message.role === "custom") {
    const customBlock = message.content.find((b) => b.type === "custom");
    if (customBlock && (customBlock as { customType?: string }).customType) {
      return getCustomTypeIcon((customBlock as { customType: string }).customType);
    }
    return getRoleIcon("custom");
  }

  const toolBlock = message.content.find(
    (b) => b.type === "toolCall" || b.type === "toolExecution" || b.type === "toolResult",
  );
  if (toolBlock) {
    const name =
      toolBlock.type === "toolCall" ? (toolBlock.name ?? "tool") : (toolBlock.toolName ?? "tool");
    return getToolIcon(name);
  }

  if (message.role === "toolResult") return getRoleIcon("toolResult");
  return getRoleIcon("assistant");
}
