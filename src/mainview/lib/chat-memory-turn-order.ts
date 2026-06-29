import type { ChatMessage } from "../types";

function getMemoryTurnPlacement(msg: ChatMessage): "after-user" | "after-turn" | null {
  if (msg.role !== "custom") return null;
  const customBlock = msg.content.find(
    (block): block is Extract<(typeof msg)["content"][number], { type: "custom" }> =>
      block.type === "custom",
  );
  if (!customBlock) return null;
  if (
    customBlock.customType === "memory_prefetch" ||
    customBlock.customType === "memory_prefetch_result"
  ) {
    return "after-user";
  }
  if (customBlock.customType === "memory_inject") {
    return "after-turn";
  }
  return null;
}

export function reorderMemoryMessagesWithinTurns(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 1) return messages;

  const reordered: ChatMessage[] = [];

  for (let start = 0; start < messages.length; ) {
    const first = messages[start];
    if (first.role !== "user") {
      reordered.push(first);
      start += 1;
      continue;
    }

    let end = start + 1;
    while (end < messages.length && messages[end].role !== "user") {
      end += 1;
    }

    const turn = messages.slice(start, end);
    const afterUser: ChatMessage[] = [];
    const afterTurn: ChatMessage[] = [];
    const middle: ChatMessage[] = [];

    for (const msg of turn.slice(1)) {
      const placement = getMemoryTurnPlacement(msg);
      if (placement === "after-user") {
        afterUser.push(msg);
      } else if (placement === "after-turn") {
        afterTurn.push(msg);
      } else {
        middle.push(msg);
      }
    }

    reordered.push(turn[0], ...afterUser, ...middle, ...afterTurn);
    start = end;
  }

  return reordered;
}
