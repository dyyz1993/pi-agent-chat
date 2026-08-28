export interface CustomEntryMeta {
  icon: string;
  label: string;
  color: string;
  standalone: boolean;
  priority: "low" | "medium" | "high";
}

const registry = new Map<string, CustomEntryMeta>([
  [
    "memory_prefetch_result",
    {
      icon: "SearchCheck",
      label: "Memory Match",
      color: "text-status-info",
      standalone: true,
      priority: "high",
    },
  ],
  [
    "memory_inject",
    {
      icon: "ArrowDownToLine",
      label: "Memory Inject",
      color: "text-status-info",
      standalone: true,
      priority: "medium",
    },
  ],
  [
    "bash_background_process",
    {
      icon: "Terminal",
      label: "Background Process",
      color: "text-semantic-tool",
      standalone: false,
      priority: "low",
    },
  ],
  [
    "bash_background_exit",
    {
      icon: "Terminal",
      label: "Background Exit",
      color: "text-semantic-tool",
      standalone: false,
      priority: "low",
    },
  ],
  [
    "lsp_diagnostics",
    {
      icon: "SearchCheck",
      label: "LSP Diagnostics",
      color: "text-status-info",
      standalone: true,
      priority: "medium",
    },
  ],
  [
    "step_snapshot",
    {
      icon: "Camera",
      label: "Step Snapshot",
      color: "text-accent",
      standalone: true,
      priority: "medium",
    },
  ],
  [
    "compaction",
    {
      icon: "Archive",
      label: "Compaction",
      color: "text-semantic-agent",
      standalone: true,
      priority: "medium",
    },
  ],
]);

export function getCustomEntryMeta(type: string): CustomEntryMeta | undefined {
  return registry.get(type);
}

export function registerCustomEntryType(type: string, meta: CustomEntryMeta): void {
  registry.set(type, meta);
}

export function getAllCustomEntryTypes(): string[] {
  return Array.from(registry.keys());
}
