export interface ForkableTurnTarget {
  userEntryId?: string | null;
  assistantEntryId?: string | null;
  userMessageId?: string | null;
  assistantMessageId?: string | null;
}

/**
 * Fork should preserve the completed visible turn. For a completed turn, the
 * assistant entry is the leaf that includes both the user request and response.
 */
export function pickForkEntryIdForTurn(turn: ForkableTurnTarget): string | null {
  return turn.assistantEntryId ?? turn.userEntryId ?? null;
}

export function pickForkFallbackMessageIds(turn: ForkableTurnTarget): string[] {
  return [turn.assistantMessageId, turn.userMessageId].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
}
