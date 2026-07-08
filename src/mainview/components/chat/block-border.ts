import type { ContentBlock } from "../../types";
import { LSP_CUSTOM_TYPES_SET } from "./lsp-constants";
import { isBashBackgroundProcessType } from "./bash-background-process";

export function getBlockBorderColor(block: ContentBlock, role: "user" | "assistant"): string {
  const roleDefault = role === "user" ? "border-l-status-info/60" : "border-l-status-success/60";

  switch (block.type) {
    case "thinking":
      return "border-l-semantic-agent/60 dark:border-l-semantic-agent/70";
    case "toolCall":
      return "border-l-status-warning/70 dark:border-l-status-warning/80";
    case "toolResult":
      return block.isError
        ? "border-l-status-error/70 dark:border-l-status-error/80"
        : "border-l-status-success/60 dark:border-l-status-success/70";
    case "toolExecution": {
      if (block.toolName.toLowerCase() === "subagent") {
        return block.status === "error"
          ? "border-l-status-error/70 dark:border-l-status-error/80"
          : "border-l-semantic-agent/60 dark:border-l-semantic-agent/70";
      }
      if (block.status === "running")
        return "border-l-status-info/70 dark:border-l-status-info/80 animate-pulse";
      if (block.status === "error") return "border-l-status-error/70 dark:border-l-status-error/80";
      return "border-l-semantic-tool/60 dark:border-l-semantic-tool/70";
    }
    case "custom": {
      const ct = block.customType;
      if (LSP_CUSTOM_TYPES_SET.has(ct))
        return "border-l-status-warning/50 dark:border-l-status-warning/60";
      if (ct.startsWith("memory_prefetch"))
        return "border-l-status-info/50 dark:border-l-status-info/60";
      if (ct.startsWith("memory_dream"))
        return "border-l-semantic-agent/50 dark:border-l-semantic-agent/60";
      if (ct.startsWith("memory_extract"))
        return "border-l-status-success/50 dark:border-l-status-success/60";
      if (ct === "memory_created")
        return "border-l-semantic-memory/50 dark:border-l-semantic-memory/60";
      if (ct === "memory_failed") return "border-l-status-error/50 dark:border-l-status-error/60";
      if (ct === "step_snapshot")
        return "border-l-accent/50 dark:border-l-accent/60";
      if (isBashBackgroundProcessType(ct))
        return "border-l-semantic-tool/50 dark:border-l-semantic-tool/60";
      return roleDefault;
    }
    case "compactionSummary":
      return "border-l-semantic-tool/50 dark:border-l-semantic-tool/60";
    case "uiInteraction": {
      if (block.status === "pending")
        return "border-l-status-warning/60 dark:border-l-status-warning/70";
      if (block.status === "responded")
        return "border-l-status-success/60 dark:border-l-status-success/70";
      if (block.status === "dismissed") return "border-l-text-tertiary/40";
      return "border-l-semantic-tool/50 dark:border-l-semantic-tool/60";
    }
    default:
      return roleDefault;
  }
}

export function getDefaultBorderColor(role: "user" | "assistant"): string {
  return role === "user" ? "border-l-status-info/60" : "border-l-status-success/50";
}
