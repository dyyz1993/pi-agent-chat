import type { ChatMessage, ContentBlock } from "../types";

/**
 * Compare two content block arrays with early exit.
 * Avoids JSON.stringify by doing field-by-field comparison.
 * V8 string `===` short-circuits on pointer/length, so identical strings
 * are O(1) — making the common "unchanged" case very fast.
 */
function isContentSame(a: ContentBlock[], b: ContentBlock[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ba = a[i];
    const bb = b[i];
    if (ba.type !== bb.type) return false;
    switch (ba.type) {
      case "text": {
        const ob = bb as Extract<ContentBlock, { type: "text" }>;
        if (ba.text !== ob.text) return false;
        break;
      }
      case "thinking": {
        const ob = bb as Extract<ContentBlock, { type: "thinking" }>;
        if (ba.thinking !== ob.thinking) return false;
        break;
      }
      case "toolCall": {
        const ob = bb as Extract<ContentBlock, { type: "toolCall" }>;
        if (ba.name !== ob.name || ba.input !== ob.input || ba.id !== ob.id) return false;
        break;
      }
      case "toolResult": {
        const ob = bb as Extract<ContentBlock, { type: "toolResult" }>;
        if (ba.content !== ob.content || !!ba.isError !== !!ob.isError) return false;
        break;
      }
      case "toolExecution": {
        const ob = bb as Extract<ContentBlock, { type: "toolExecution" }>;
        if (
          ba.toolName !== ob.toolName ||
          ba.status !== ob.status ||
          (ba.output ?? "") !== (ob.output ?? "") ||
          (ba.args ?? "") !== (ob.args ?? "")
        ) {
          return false;
        }
        break;
      }
      case "custom": {
        const ob = bb as Extract<ContentBlock, { type: "custom" }>;
        if (ba.customType !== ob.customType) return false;
        break;
      }
      case "compactionSummary": {
        const ob = bb as Extract<ContentBlock, { type: "compactionSummary" }>;
        if (ba.summary !== ob.summary) return false;
        break;
      }
      case "imageBlock": {
        const ob = bb as Extract<ContentBlock, { type: "imageBlock" }>;
        if (ba.url !== ob.url) return false;
        break;
      }
      case "uiInteraction": {
        const ob = bb as Extract<ContentBlock, { type: "uiInteraction" }>;
        if (ba.id !== ob.id || ba.status !== ob.status) return false;
        break;
      }
      default:
        if (JSON.stringify(ba) !== JSON.stringify(bb)) return false;
        break;
    }
  }
  return true;
}

/**
 * Lightweight revision key for a single message.
 * Used for caching/dedup — does not need to capture every field, just enough
 * to detect meaningful changes (content, metadata).
 */
export function getMessageRevisionKey(msg: ChatMessage): string {
  const record = msg as unknown as Record<string, unknown>;
  return [
    msg.id,
    msg.role,
    String(record.entryId ?? ""),
    String(msg.timestamp),
    String(record.isStreaming ?? ""),
    String(record.stopReason ?? ""),
    String(record.provider ?? ""),
    String(record.model ?? ""),
    String(msg.content.length),
  ].join("|");
}

/**
 * Compare two message arrays snapshot-by-snapshot.
 * Early-exits on first difference — avoids O(n × content_size) JSON.stringify.
 */
export function hasSameMessageSnapshots(current: ChatMessage[], next: ChatMessage[]): boolean {
  if (current.length !== next.length) return false;
  for (let i = 0; i < current.length; i++) {
    const a = current[i];
    const b = next[i];
    if (a.id !== b.id || a.role !== b.role || a.timestamp !== b.timestamp) return false;

    const ra = a as unknown as Record<string, unknown>;
    const rb = b as unknown as Record<string, unknown>;
    if (
      ra.isStreaming !== rb.isStreaming ||
      ra.stopReason !== rb.stopReason ||
      ra.provider !== rb.provider ||
      ra.model !== rb.model
    ) {
      return false;
    }

    if (!isContentSame(a.content, b.content)) return false;
  }
  return true;
}
