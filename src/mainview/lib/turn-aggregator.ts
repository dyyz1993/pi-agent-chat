import type { ChatMessage, TimelineTurn, TimelineItem, StandaloneEntry } from "../types";

export function aggregateTurns(messages: ChatMessage[]): { turns: TimelineTurn[]; standalone: StandaloneEntry[] } {
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

        const text = msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n") || "";

        currentTurn = {
          id: `turn_${msg.id}`,
          userMessageId: msg.id,
          userText: text,
          userTimestamp: msg.timestamp,
          assistantMessageId: null,
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
            userText: "",
            userTimestamp: msg.timestamp,
            assistantMessageId: msg.id,
            items: [],
            model: msg.model,
            provider: msg.provider,
            tokenUsage: msg.tokenUsage,
            isStreaming: msg.isStreaming ?? false,
            collapsed: false,
          };
        } else {
          currentTurn.assistantMessageId = msg.id;
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
            currentTurn.items.push({
              itemType: "toolExecution",
              blockIndex: bi,
              toolCallId: block.toolCallId,
              toolName: block.toolName,
              args: block.args,
              status: block.status,
              output: block.output,
              details: block.details,
              messageId: msg.id,
            });
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
        const customBlock = msg.content.find((b): b is Extract<typeof b, { type: "custom" }> => b.type === "custom");
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
    userText: partial.userText ?? "",
    userTimestamp: partial.userTimestamp ?? Date.now(),
    assistantMessageId: partial.assistantMessageId ?? null,
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
