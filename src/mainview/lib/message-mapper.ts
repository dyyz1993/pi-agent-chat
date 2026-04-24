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

/**
 * 将 toolResult 类型的 raw message 转为 ContentBlock
 * toolResult 消息的 content 是 text 数组，toolName 从 toolCallNameMap 查找
 */
export function parseToolResultMessage(
  message: Record<string, unknown>,
  toolCallNameMap: Record<string, string>,
): ContentBlock | null {
  const toolCallId = message.toolCallId as string;
  if (!toolCallId) return null;

  const toolName = toolCallNameMap[toolCallId] ?? (message.name as string) ?? "unknown";
  const rawContent = message.content;
  let contentText = "";
  if (Array.isArray(rawContent)) {
    contentText = rawContent
      .map((c: Record<string, unknown>) => (c.text as string) ?? "")
      .filter(Boolean)
      .join("");
  } else if (typeof rawContent === "string") {
    contentText = rawContent;
  }

  return {
    type: "toolResult",
    toolCallId,
    toolName,
    content: contentText,
    isError: (message.isError as boolean) ?? false,
  };
}

export function messageToChatMessage(
  message: Record<string, unknown>,
  id?: string,
  toolCallNameMap?: Record<string, string>,
): ChatMessage | null {
  const role = message.role as string;
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;

  // toolResult 走专用解析
  if (role === "toolResult") {
    const block = parseToolResultMessage(message, toolCallNameMap ?? {});
    if (!block) return null;
    return {
      id: id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "toolResult",
      content: [block],
      timestamp: (message.timestamp as number) || Date.now(),
    };
  }

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
