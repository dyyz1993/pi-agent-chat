import type { ChatMessage, TimelineTurn, TimelineItem, StandaloneEntry } from "../types";
import {
  hasOverlappingToolExecutionKeys,
  toolExecutionItemToBlock,
} from "./tool-execution-reconciler";

export function aggregateTurns(messages: ChatMessage[]): {
  turns: TimelineTurn[];
  standalone: StandaloneEntry[];
} {
  const turns: TimelineTurn[] = [];
  const standalone: StandaloneEntry[] = [];

  let currentTurn: Partial<TimelineTurn> | null = null;
  let turnIndex = 0;

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        if (currentTurn && currentTurn.items && currentTurn.items.length > 0) {
          turns.push(finalizeTurn(currentTurn, turnIndex++));
        }

        const text =
          msg.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n") || "";

        currentTurn = {
          id: `turn_${msg.id}`,
          userMessageId: msg.id,
          userEntryId: msg.entryId ?? null,
          userText: text,
          userTimestamp: msg.timestamp,
          assistantMessageId: null,
          assistantEntryId: null,
          items: [],
          isStreaming: msg.isStreaming ?? false,
          collapsed: false,
        };
        break;
      }

      case "assistant": {
        if (!currentTurn) {
          currentTurn = {
            id: `turn_orphan_${msg.id}`,
            userMessageId: null,
            userEntryId: null,
            userText: "",
            userTimestamp: msg.timestamp,
            assistantMessageId: msg.id,
            assistantEntryId: msg.entryId ?? null,
            items: [],
            model: msg.model,
            provider: msg.provider,
            tokenUsage: msg.tokenUsage,
            isStreaming: msg.isStreaming ?? false,
            collapsed: false,
          };
        } else {
          currentTurn.assistantMessageId = msg.id;
          currentTurn.assistantEntryId = msg.entryId ?? null;
          if (!currentTurn.model && msg.model) currentTurn.model = msg.model;
          if (!currentTurn.provider && msg.provider) currentTurn.provider = msg.provider;
          if (!currentTurn.tokenUsage && msg.tokenUsage) currentTurn.tokenUsage = msg.tokenUsage;
          if (msg.isStreaming) currentTurn.isStreaming = true;
        }

        for (let bi = 0; bi < msg.content.length; bi++) {
          const block = msg.content[bi];

          if (block.type === "text" || block.type === "thinking") {
            currentTurn.items = currentTurn.items ?? [];
            currentTurn.items.push({
              itemType: "assistantText",
              blockIndex: bi,
              text: block.type === "text" ? block.text : block.thinking,
              messageId: msg.id,
            });
          } else if (block.type === "toolExecution") {
            currentTurn.items = currentTurn.items ?? [];
            const item = {
              itemType: "toolExecution",
              blockIndex: bi,
              toolCallId: block.toolCallId,
              toolName: block.toolName,
              args: block.args,
              status: block.status,
              output: block.output,
              details: block.details,
              messageId: msg.id,
            } satisfies TimelineItem;
            const existingIdx = currentTurn.items.findIndex((existing) => {
              if (existing.itemType !== "toolExecution") return false;
              return hasOverlappingToolExecutionKeys(toolExecutionItemToBlock(existing), block);
            });
            if (existingIdx >= 0) {
              currentTurn.items[existingIdx] = item;
            } else {
              currentTurn.items.push(item);
            }
          } else if (block.type === "custom") {
            currentTurn.items = currentTurn.items ?? [];
            currentTurn.items.push({
              itemType: "customEntry",
              entryId: `${msg.id}_${bi}`,
              customType: block.customType,
              data: block.data,
              timestamp: msg.timestamp,
            });
          }
        }
        break;
      }

      case "custom": {
        const customBlock = msg.content.find(
          (b): b is Extract<typeof b, { type: "custom" }> => b.type === "custom",
        );
        if (!customBlock) break;

        const entry: StandaloneEntry = {
          id: msg.id,
          customType: customBlock.customType,
          data: customBlock.data,
          timestamp: msg.timestamp,
        };

        if (currentTurn && currentTurn.assistantMessageId) {
          currentTurn.items = currentTurn.items ?? [];
          currentTurn.items.push({
            itemType: "customEntry",
            entryId: msg.id,
            customType: customBlock.customType,
            data: customBlock.data,
            timestamp: msg.timestamp,
          });
        } else {
          standalone.push(entry);
        }
        break;
      }

      case "toolResult": {
        break;
      }

      case "compactionSummary": {
        if (currentTurn && currentTurn.items && currentTurn.items.length > 0) {
          turns.push(finalizeTurn(currentTurn, turnIndex++));
        } else if (currentTurn && currentTurn.userMessageId) {
          turns.push(finalizeTurn(currentTurn, turnIndex++));
        }
        currentTurn = null;
        const summaryBlock = msg.content.find((b) => b.type === "compactionSummary");
        const summary = summaryBlock && "summary" in summaryBlock ? summaryBlock.summary : "";
        standalone.push({
          id: msg.id,
          customType: "compactionSummary",
          data: { summary },
          timestamp: msg.timestamp,
          icon: "Archive",
          label: "上下文压缩",
        });
        break;
      }
    }
  }

  if (currentTurn && currentTurn.items && currentTurn.items.length > 0) {
    turns.push(finalizeTurn(currentTurn, turnIndex));
  } else if (currentTurn && currentTurn.userMessageId) {
    turns.push(finalizeTurn(currentTurn, turnIndex));
  }

  return { turns, standalone };
}

function finalizeTurn(partial: Partial<TimelineTurn>, index: number): TimelineTurn {
  return {
    id: partial.id ?? `turn_${index}`,
    index,
    userMessageId: partial.userMessageId ?? null,
    userEntryId: partial.userEntryId ?? null,
    userText: partial.userText ?? "",
    userTimestamp: partial.userTimestamp ?? Date.now(),
    assistantMessageId: partial.assistantMessageId ?? null,
    assistantEntryId: partial.assistantEntryId ?? null,
    items: partial.items ?? [],
    model: partial.model,
    provider: partial.provider,
    tokenUsage: partial.tokenUsage,
    isStreaming: partial.isStreaming ?? false,
    collapsed: partial.collapsed ?? false,
  };
}

export function getItemId(item: TimelineItem): string {
  switch (item.itemType) {
    case "userMessage":
      return `user_${item.messageId}`;
    case "assistantText":
      return `text_${item.messageId}_${item.blockIndex}`;
    case "toolExecution":
      return `tool_${item.toolCallId}`;
    case "customEntry":
      return `custom_${item.entryId}`;
  }
}
