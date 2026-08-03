import { useCallback } from "react";
import type { ChatMessage } from "../../types";
import { apiClient } from "../../lib/api-client";

function stringifyMessageBlock(block: ChatMessage["content"][number]): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "thinking":
      return `[thinking]\n${block.thinking}`;
    case "toolCall":
      return `[tool call: ${block.name}]\n${block.input}`;
    case "toolResult":
      return `[tool result: ${block.toolName}${block.isError ? " error" : ""}]\n${block.content}`;
    case "toolExecution": {
      const parts = [`[tool execution: ${block.toolName} ${block.status}]`];
      if (block.description) parts.push(block.description);
      if (block.args) parts.push(`args:\n${block.args}`);
      if (block.output) parts.push(`output:\n${block.output}`);
      return parts.join("\n");
    }
    case "compactionSummary":
      return `[compaction summary]\n${block.summary}`;
    case "custom":
      return `[${block.customType}]\n${JSON.stringify(block.data)}`;
    case "imageBlock":
      return `[image: ${block.alt ?? block.url}]`;
    default:
      return JSON.stringify(block);
  }
}

function buildSelectedMemoryContent(messages: ChatMessage[], ids: string[]): string {
  const selected = new Set(ids);
  return messages
    .filter((message) => selected.has(message.id))
    .map((message) => {
      const body = message.content.map(stringifyMessageBlock).filter(Boolean).join("\n\n");
      return `## ${message.role} ${message.id}\n\n${body || "(empty)"}`;
    })
    .join("\n\n---\n\n")
    .trim();
}

export interface UseMessageActionsDeps {
  activeSessionId: string | null;
  activeSubId: string | null | undefined;
  isViewingSubagent: boolean;
  messages: ChatMessage[];
  chatProjectPath: string;
  deleteMessagesForSession: (sessionId: string, ids: string[]) => void;
  clearMessageSelection: () => void;
  loadSessionMessages: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  pushNotif: (n: { message: string; level: "info" | "warning" | "error" }) => void;
}

export interface MessageActionsApi {
  handleDeleteSelectedMessages: (ids: string[]) => Promise<void>;
  handleSummarizeSelectedMessages: (ids: string[]) => Promise<void>;
  handleRememberSelectedMessages: (ids: string[]) => Promise<void>;
}

/**
 * Encapsulates the three message-selection bulk actions (delete, summarize,
 * remember) that ChatPanel exposes via MessageSelectionBar.
 *
 * Pulled out as part of the ChatPanel decomposition.
 */
export function useMessageActions(deps: UseMessageActionsDeps): MessageActionsApi {
  const handleDeleteSelectedMessages = useCallback(
    async (ids: string[]) => {
      const targetSessionId = deps.isViewingSubagent ? deps.activeSubId : deps.activeSessionId;
      if (!targetSessionId || ids.length === 0) return;

      const targetIds = Array.from(new Set(ids));
      deps.deleteMessagesForSession(targetSessionId, targetIds);
      deps.clearMessageSelection();

      try {
        await apiClient.call("agent.deleteEntries", {
          sessionId: targetSessionId,
          targetIds,
        });
        await deps.loadSessionMessages(targetSessionId, { force: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.pushNotif({ message: `删除消息失败：${message}`, level: "error" });
        await deps.loadSessionMessages(targetSessionId, { force: true }).catch(() => undefined);
      }
    },
    [deps],
  );

  const handleSummarizeSelectedMessages = useCallback(
    async (ids: string[]) => {
      const targetSessionId = deps.isViewingSubagent ? deps.activeSubId : deps.activeSessionId;
      if (!targetSessionId || ids.length === 0) return;

      const targetIds = Array.from(new Set(ids));
      deps.clearMessageSelection();

      try {
        await apiClient.call("agent.summarizeEntries", {
          sessionId: targetSessionId,
          targetIds,
        });
        await deps.loadSessionMessages(targetSessionId, { force: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.pushNotif({ message: `总结消息失败：${message}`, level: "error" });
      }
    },
    [deps],
  );

  const handleRememberSelectedMessages = useCallback(
    async (ids: string[]) => {
      const targetSessionId = deps.isViewingSubagent ? deps.activeSubId : deps.activeSessionId;
      if (!targetSessionId || ids.length === 0) return;

      const targetIds = Array.from(new Set(ids));
      const content = buildSelectedMemoryContent(deps.messages, targetIds);
      if (!content) return;

      deps.clearMessageSelection();

      try {
        await apiClient.call("memory.remember", {
          projectPath: deps.chatProjectPath,
          sessionId: targetSessionId,
          messageIds: targetIds,
          content,
        });
        deps.pushNotif({ message: "已提交到 Learning 记忆", level: "info" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.pushNotif({ message: `保存记忆失败：${message}`, level: "error" });
      }
    },
    [deps],
  );

  return {
    handleDeleteSelectedMessages,
    handleSummarizeSelectedMessages,
    handleRememberSelectedMessages,
  };
}
