import { aggregateTurns } from "../lib/turn-aggregator";
import type { ChatMessage, Turn } from "../types";

export function groupMessagesIntoTurns(messages: ChatMessage[]): Turn[] {
  const { turns } = aggregateTurns(messages);

  return turns.map((turn, index) => {
    const assistantMessageIds = Array.from(
      new Set(
        turn.items
          .filter((item) => item.itemType === "assistantText" || item.itemType === "toolExecution")
          .map((item) => item.messageId),
      ),
    );

    if (turn.assistantMessageId && !assistantMessageIds.includes(turn.assistantMessageId)) {
      assistantMessageIds.push(turn.assistantMessageId);
    }

    return {
      id: turn.id,
      userMessageId: turn.userMessageId,
      assistantMessageIds,
      index,
      timestamp: turn.userTimestamp,
      tokenUsage: turn.tokenUsage,
    };
  });
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    const str = (n / 1_000_000).toFixed(1);
    return `${str}M`;
  }
  if (n >= 1_000) {
    const str = (n / 1_000).toFixed(n % 1000 === 0 ? 0 : 1);
    if (parseFloat(str) >= 1000) {
      return `${(parseFloat(str) / 1000).toFixed(1)}M`;
    }
    return `${str}K`;
  }
  return `${n}`;
}
