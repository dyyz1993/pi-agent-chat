import type { ChatMessage } from "../types";

export function getMessageRevisionKey(msg: ChatMessage): string {
  const record = msg as unknown as Record<string, unknown>;
  try {
    return JSON.stringify({
      id: msg.id,
      role: msg.role,
      entryId: record.entryId,
      timestamp: msg.timestamp,
      isStreaming: record.isStreaming,
      stopReason: record.stopReason,
      provider: record.provider,
      model: record.model,
      tokenUsage: record.tokenUsage,
      content: msg.content,
    });
  } catch {
    return [
      msg.id,
      msg.role,
      String(msg.timestamp),
      String(record.entryId ?? ""),
      String(record.isStreaming ?? ""),
      String(record.stopReason ?? ""),
      String(msg.content.length),
    ].join("|");
  }
}

export function hasSameMessageSnapshots(current: ChatMessage[], next: ChatMessage[]): boolean {
  return (
    current.length === next.length &&
    current.every((msg, index) => getMessageRevisionKey(msg) === getMessageRevisionKey(next[index]))
  );
}
