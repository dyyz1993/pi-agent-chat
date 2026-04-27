export interface CustomEntryMeta {
  icon: string; // lucide-react icon name or emoji
  label: string;
  color: string; // tailwind text color class
  standalone: boolean; // true = always shown as standalone, false = can be inline in turn
  priority: "high" | "medium" | "low";
}

const registry = new Map<string, CustomEntryMeta>();

// Register built-in types
function initRegistry(): void {
  const builtins: [string, CustomEntryMeta][] = [
    ["memory_prefetch_result", {
      icon: "Brain",
      label: "Memory Prefetch",
      color: "text-blue-400",
      standalone: true,
      priority: "high",
    }],
    ["memory_inject", {
      icon: "ArrowDownToLine",
      label: "Memory Inject",
      color: "text-cyan-400",
      standalone: true,
      priority: "medium",
    }],
    ["bash_background_exit", {
      icon: "Terminal",
      label: "Background Process Exit",
      color: "text-amber-400",
      standalone: false,
      priority: "low",
    }],
    ["lsp_diagnostics", {
      icon: "ScanLine",
      label: "LSP Diagnostics",
      color: "text-orange-400",
      standalone: false,
      priority: "low",
    }],
    ["step_snapshot", {
      icon: "Camera",
      label: "Snapshot",
      color: "text-purple-400",
      standalone: true,
      priority: "medium",
    }],
    ["compaction", {
      icon: "Minimize2",
      label: "Compaction",
      color: "text-gray-400",
      standalone: true,
      priority: "low",
    }],
  ];

  for (const [key, meta] of builtins) {
    registry.set(key, meta);
  }
}

// Lazy init
let initialized = false;
function ensureInit(): void {
  if (!initialized) {
    initRegistry();
    initialized = true;
  }
}

export function getCustomEntryMeta(customType: string): CustomEntryMeta | undefined {
  ensureInit();
  return registry.get(customType);
}

export function registerCustomEntryType(type: string, meta: CustomEntryMeta): void {
  ensureInit();
  registry.set(type, meta);
}

export function getAllCustomEntryTypes(): string[] {
  ensureInit();
  return Array.from(registry.keys());
}
