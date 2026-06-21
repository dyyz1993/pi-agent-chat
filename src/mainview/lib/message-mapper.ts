import type { ChatMessage, ContentBlock, TokenUsage } from "../types";
import type {
  Message,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ImageContent,
  Usage,
} from "@dyyz1993/pi-ai";

function extractTokenUsage(usage: Usage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const input = usage.input;
  const output = usage.output;
  const cacheRead = usage.cacheRead;
  const cacheWrite = usage.cacheWrite;
  const cost = usage.cost?.total;

  if (!input && !output && !cacheRead && !cacheWrite) return undefined;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    cost: cost ?? 0,
  };
}

function extractTimestamp(msg: Message): number {
  return msg.timestamp;
}

function extractContent(msg: UserMessage | AssistantMessage): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (typeof msg.content === "string") {
    if (msg.content) {
      blocks.push({ type: "text", text: msg.content });
    }
    return blocks;
  }

  for (const block of msg.content ?? []) {
    if (block.type === "text") {
      const textBlock = block as TextContent;
      if (textBlock.text) {
        blocks.push({ type: "text", text: textBlock.text });
      }
    } else if (block.type === "thinking") {
      const thinkingBlock = block as ThinkingContent;
      if (thinkingBlock.thinking) {
        blocks.push({ type: "thinking", thinking: thinkingBlock.thinking });
      }
    } else if (block.type === "toolCall") {
      const toolCall = block as ToolCall;
      const input = JSON.stringify(toolCall.arguments, null, 2);
      blocks.push({ type: "toolCall", id: toolCall.id, name: toolCall.name, input });
    } else if (block.type === "image") {
      const imgBlock = block as ImageContent;
      if (imgBlock.data && imgBlock.mimeType) {
        blocks.push({
          type: "imageBlock",
          url: `data:${imgBlock.mimeType};base64,${imgBlock.data}`,
          alt: "uploaded image",
        });
      }
    }
  }

  return blocks;
}

function getTextContent(msg: Pick<ChatMessage, "content">): string {
  return msg.content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractToolCallNameMap(
  msg: AssistantMessage,
  toolCallNameMap: Record<string, string>,
): void {
  for (const block of msg.content) {
    if (block.type === "toolCall") {
      const toolCall = block as ToolCall;
      toolCallNameMap[toolCall.id] = toolCall.name;
    }
  }
}

export function parseToolResultBlock(
  message: ToolResultMessage,
  toolCallNameMap: Record<string, string>,
): ContentBlock | null {
  const toolCallId = message.toolCallId;
  const toolName = toolCallNameMap[toolCallId] ?? message.toolName;

  let contentText = "";
  if (Array.isArray(message.content)) {
    contentText = message.content
      .map((c) => {
        if (c.type === "text") return c.text;
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  return {
    type: "toolResult",
    toolCallId,
    toolName,
    content: contentText,
    isError: message.isError,
    args: undefined,
    details: message.details,
  };
}

function extractEntryId(raw: unknown): string | undefined {
  if (raw && typeof raw === "object" && "entryId" in raw) {
    const v = (raw as Record<string, unknown>).entryId;
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

function nextMsgId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function messageToChatMessage(
  message: Message,
  id?: string,
  toolCallNameMap?: Record<string, string>,
): ChatMessage | null {
  if (!message || typeof message !== "object" || !("role" in message)) return null;

  const role = message.role as string;
  const msgId = id ?? nextMsgId();
  const entryId = extractEntryId(message);

  if (role === "custom") {
    const customMsg = message as unknown as {
      customType?: string;
      data?: unknown;
      details?: unknown;
    };
    const customType = customMsg.customType ?? "unknown";
    const data = customMsg.details ?? customMsg.data ?? {};
    return {
      id: msgId,
      role: "custom",
      content: [{ type: "custom" as const, customType, data }],
      timestamp: extractTimestamp(message),
      ...(entryId ? { entryId } : {}),
    };
  }

  if (role === "compactionSummary") {
    const raw = message as unknown as {
      summary?: string;
      tokensBefore?: number;
      status?: "running" | "completed" | "failed" | "aborted";
      reason?: string;
    };
    const summary = raw.summary ?? "";
    return {
      id: msgId,
      role: "compactionSummary",
      content: [
        {
          type: "compactionSummary" as const,
          summary,
          tokensBefore: raw.tokensBefore,
          status: raw.status,
          reason: raw.reason,
        },
      ],
      timestamp: extractTimestamp(message),
      ...(entryId ? { entryId } : {}),
    };
  }

  if (role === "toolResult") {
    const toolMsg = message as ToolResultMessage;
    const block = parseToolResultBlock(toolMsg, toolCallNameMap ?? {});
    if (!block) return null;
    return {
      id: msgId,
      role: "toolResult",
      content: [block],
      timestamp: extractTimestamp(message),
      ...(entryId ? { entryId } : {}),
    };
  }

  if (role === "user") {
    const userMsg = message as UserMessage;
    const content = extractContent(userMsg);
    if (content.length === 0) return null;

    return {
      id: msgId,
      role: "user",
      content,
      timestamp: extractTimestamp(message),
      ...(entryId ? { entryId } : {}),
    };
  }

  if (role !== "assistant") return null;

  const asstMsg = message as AssistantMessage;
  const content = extractContent(asstMsg);
  if (content.length === 0) return null;

  const msg: ChatMessage = {
    id: msgId,
    role: "assistant",
    content,
    timestamp: extractTimestamp(message),
    ...(entryId ? { entryId } : {}),
  };

  if (asstMsg.provider) msg.provider = asstMsg.provider;
  if (asstMsg.model) msg.model = asstMsg.model;
  if (asstMsg.stopReason) msg.stopReason = asstMsg.stopReason;

  const usage = extractTokenUsage(asstMsg.usage);
  if (usage) msg.tokenUsage = usage;

  return msg;
}

export {
  extractTokenUsage,
  extractTimestamp,
  extractContent,
  extractToolCallNameMap,
  getTextContent,
};
