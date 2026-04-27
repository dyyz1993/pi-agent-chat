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
  SearchCheck,
  Save,
  Sparkles,
  Activity,
  type LucideIcon,
} from "lucide-react";

export type ToolIconEntry = {
  icon: LucideIcon;
  color: string;
  label: string;
};

const TOOL_ICON_MAP: Record<string, ToolIconEntry> = {
  subagent: { icon: Bot, color: "text-purple-400", label: "SubAgent" },
  read: { icon: Eye, color: "text-blue-400", label: "Read" },
  edit: { icon: Pencil, color: "text-green-400", label: "Edit" },
  write: { icon: Pencil, color: "text-green-400", label: "Write" },
  search: { icon: Search, color: "text-yellow-400", label: "Search" },
  grep: { icon: Search, color: "text-yellow-400", label: "Grep" },
  glob: { icon: Search, color: "text-yellow-400", label: "Glob" },
  code: { icon: Code, color: "text-purple-400", label: "Code" },
  terminal: { icon: Terminal, color: "text-cyan-400", label: "Terminal" },
  bash: { icon: Terminal, color: "text-cyan-400", label: "Bash" },
  image: { icon: ImageIcon, color: "text-pink-400", label: "Image" },
  folder: { icon: FolderOpen, color: "text-amber-400", label: "Folder" },
  git: { icon: GitBranch, color: "text-orange-400", label: "Git" },
  web: { icon: Globe, color: "text-sky-400", label: "Web" },
  fetch: { icon: Globe, color: "text-sky-400", label: "Fetch" },
  db: { icon: Database, color: "text-teal-400", label: "Database" },
  mcp: { icon: Cpu, color: "text-violet-400", label: "MCP" },
  lsp: { icon: Network, color: "text-blue-400", label: "LSP" },
  lsp_health: { icon: Network, color: "text-blue-400", label: "LSP Health" },
  preview: { icon: Eye, color: "text-emerald-400", label: "Preview" },
};

const DEFAULT_ENTRY: ToolIconEntry = {
  icon: Wrench,
  color: "text-gray-400",
  label: "Tool",
};

const PREVIEW_TYPE_ICON_MAP: Record<string, ToolIconEntry> = {
  image:    { icon: ImageIcon,  color: "text-pink-400",    label: "Image" },
  url:      { icon: Globe,      color: "text-sky-400",     label: "URL" },
  html:     { icon: Code,       color: "text-orange-400",  label: "HTML" },
  pdf:      { icon: FileText,   color: "text-red-400",     label: "PDF" },
  video:    { icon: Video,      color: "text-purple-400",  label: "Video" },
  audio:    { icon: Music,      color: "text-cyan-400",    label: "Audio" },
  markdown: { icon: File,       color: "text-amber-400",   label: "Markdown" },
  text:     { icon: FileText,   color: "text-gray-400",    label: "Text" },
};

export function getPreviewResourceIcon(resourceType: string): ToolIconEntry {
  return PREVIEW_TYPE_ICON_MAP[resourceType.toLowerCase()] ?? PREVIEW_TYPE_ICON_MAP["text"]!;
}

const USER_ENTRY: ToolIconEntry = {
  icon: User,
  color: "text-indigo-400",
  label: "User",
};

const ASSISTANT_ENTRY: ToolIconEntry = {
  icon: Bot,
  color: "text-green-400",
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
  memory_prefetch: { icon: SearchCheck, color: "text-blue-400", label: "Memory Search" },
  memory_prefetch_result: { icon: SearchCheck, color: "text-blue-400", label: "Memories Found" },
  memory_extract: { icon: Save, color: "text-green-400", label: "Memory Saved" },
  memory_extract_result: { icon: Save, color: "text-green-400", label: "Extraction Result" },
  memory_dream: { icon: Sparkles, color: "text-purple-400", label: "Memory Consolidation" },
  memory_dream_result: { icon: Sparkles, color: "text-purple-400", label: "Dream Result" },
  lsp_diagnostics: { icon: Network, color: "text-yellow-400", label: "LSP Diagnostics" },
  bash_background_exit: { icon: Terminal, color: "text-cyan-400", label: "Background Exit" },
  step_snapshot: { icon: Activity, color: "text-gray-400", label: "Step Snapshot" },
};

const CUSTOM_TYPE_DEFAULT: ToolIconEntry = {
  icon: Brain,
  color: "text-purple-400",
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

export function getMessageIcon(message: { role: string; content: Array<{ type: string; name?: string; toolName?: string; customType?: string }> }): ToolIconEntry {
  if (message.role === "user") return getRoleIcon("user");
  if (message.role === "custom") {
    const customBlock = message.content.find((b) => b.type === "custom");
    if (customBlock && (customBlock as { customType?: string }).customType) {
      return getCustomTypeIcon((customBlock as { customType: string }).customType);
    }
    return getRoleIcon("custom");
  }

  const toolBlock = message.content.find(
    (b) => b.type === "toolCall" || b.type === "toolExecution" || b.type === "toolResult"
  );
  if (toolBlock) {
    const name =
      toolBlock.type === "toolCall"
        ? (toolBlock.name ?? "tool")
        : (toolBlock.toolName ?? "tool");
    return getToolIcon(name);
  }

  if (message.role === "toolResult") return getRoleIcon("toolResult");
  return getRoleIcon("assistant");
}
