import type { ChatMessage, Turn } from "../types";

export function groupMessagesIntoTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Partial<Turn> | null = null;
  let turnIndex = 0;

  for (const msg of messages) {
    if (msg.role === "user") {
      if (
        currentTurn != null &&
        (currentTurn.userMessageId != null || currentTurn.assistantMessageIds?.length)
      ) {
        turns.push({
          id: currentTurn.id as string,
          userMessageId: currentTurn.userMessageId ?? null,
          assistantMessageIds: currentTurn.assistantMessageIds ?? [],
          index: turnIndex++,
          timestamp: currentTurn.timestamp ?? 0,
          tokenUsage: currentTurn.tokenUsage,
        });
      }
      currentTurn = {
        id: `turn-${msg.id}`,
        userMessageId: msg.id,
        assistantMessageIds: [],
        timestamp: msg.timestamp,
      };
    } else if (msg.role === "assistant") {
      currentTurn ??= {
        id: `turn-orphan-${msg.id}`,
        userMessageId: null,
        assistantMessageIds: [],
        timestamp: msg.timestamp,
      };
      currentTurn.assistantMessageIds ??= [];
      currentTurn.assistantMessageIds.push(msg.id);
      if (msg.tokenUsage) {
        currentTurn.tokenUsage = msg.tokenUsage;
      }
    }
  }

  if (
    currentTurn != null &&
    (currentTurn.userMessageId != null || currentTurn.assistantMessageIds?.length)
  ) {
    turns.push({
      id: currentTurn.id as string,
      userMessageId: currentTurn.userMessageId ?? null,
      assistantMessageIds: currentTurn.assistantMessageIds ?? [],
      index: turnIndex,
      timestamp: currentTurn.timestamp ?? 0,
      tokenUsage: currentTurn.tokenUsage,
    });
  }

  return turns;
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return `${n}`;
}
