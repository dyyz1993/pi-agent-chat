import type { ChatMessage, ContentBlock } from "../types";

type RawContentBlock = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: string };

export function parseContentBlocks(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: ContentBlock[] = [];
  for (const b of raw as RawContentBlock[]) {
    if (b.type === "text" && b.text) {
      blocks.push({ type: "text", text: b.text });
    } else if (b.type === "thinking" && b.thinking) {
      blocks.push({ type: "thinking", thinking: b.thinking });
    } else if (b.type === "toolCall" && b.id && b.name) {
      blocks.push({ type: "toolCall", id: b.id, name: b.name, input: b.input ?? "" });
    }
  }
  return blocks;
}

export function getTextContent(msg: ChatMessage): string {
  return msg.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
}

export function messageToChatMessage(message: Record<string, unknown>, id?: string): ChatMessage | null {
  const role = message.role as string;
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;

  const content = parseContentBlocks(message.content);
  if (content.length === 0) return null;

  const msg: ChatMessage = {
    id: id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: role as ChatMessage["role"],
    content,
    timestamp: (message.timestamp as number) || Date.now(),
  };

  if (message.provider) msg.provider = message.provider as string;
  if (message.model) msg.model = message.model as string;
  if ("stopReason" in message) msg.stopReason = message.stopReason as string | null;

  return msg;
}
