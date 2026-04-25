import type { ChatMessage, ContentBlock, TokenUsage } from "../types";

function extractTokenUsage(raw: unknown): TokenUsage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const u = raw as Record<string, unknown>;
  const input = Number(u.inputTokens ?? u.promptTokens ?? u.input ?? 0);
  const output = Number(u.outputTokens ?? u.completionTokens ?? u.output ?? 0);
  const reasoning = Number(u.reasoningTokens ?? u.reasoning ?? 0);
  const cacheRead = Number(u.cacheReadInputTokens ?? u.cacheRead ?? 0);
  const cacheWrite = Number(u.cacheCreationInputTokens ?? u.cacheWrite ?? 0);
  const cost = Number(u.cost ?? u.totalCost ?? 0);

  if (!input && !output && !reasoning && !cacheRead && !cacheWrite) return undefined;

  return { input, output, reasoning: reasoning || undefined, cacheRead: cacheRead || undefined, cacheWrite: cacheWrite || undefined, cost: cost || undefined };
}

function extractTimestamp(msg: unknown): number {
  if (typeof msg === "object" && msg !== null && "timestamp" in msg && typeof (msg as Record<string, unknown>).timestamp === "number") return (msg as Record<string, unknown>).timestamp as number;
  return Date.now();
}

function extractContent(raw: unknown): ContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: ContentBlock[] = [];
  for (const b of raw) {
    if (typeof b === "string" && b) {
      blocks.push({ type: "text", text: b });
      continue;
    }
    if (typeof b !== "object" || b === null) continue;
    const block = b as Record<string, unknown>;
    const type = block.type as string;
    if (type === "text" && typeof block.text === "string" && block.text) {
      blocks.push({ type: "text", text: block.text });
    } else if (type === "thinking" && typeof block.thinking === "string" && block.thinking) {
      blocks.push({ type: "thinking", thinking: block.thinking });
    } else if (type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      const input = typeof block.input === "string"
        ? block.input
        : block.arguments != null
          ? (typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments, null, 2))
          : "";
      blocks.push({ type: "toolCall", id: block.id, name: block.name, input });
    }
  }
  return blocks;
}

function extractToolCallNameMap(msg: unknown, toolCallNameMap: Record<string, string>): void {
  if (typeof msg !== "object" || msg === null) return;
  const content = (msg as Record<string, unknown>).content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block === "object" && block !== null && "type" in block) {
      const b = block as Record<string, unknown>;
      if (b.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string") {
        toolCallNameMap[b.id] = b.name;
      }
    }
  }
}

export function parseToolResultBlock(
  message: unknown,
  toolCallNameMap: Record<string, string>,
): ContentBlock | null {
  if (typeof message !== "object" || message === null) return null;
  const toolCallId = "toolCallId" in message && typeof (message as Record<string, unknown>).toolCallId === "string"
    ? (message as Record<string, unknown>).toolCallId as string : null;
  if (!toolCallId) return null;

  const msg = message as Record<string, unknown>;
  const toolName = toolCallNameMap[toolCallId]
    ?? (typeof msg.toolName === "string" ? msg.toolName : "unknown");
  const rawContent = msg.content;
  let contentText = "";
  if (Array.isArray(rawContent)) {
    contentText = rawContent
      .map((c) => {
        if (typeof c === "object" && c !== null && "text" in c) return String(c.text ?? "");
        return "";
      })
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
    isError: typeof msg.isError === "boolean" ? msg.isError : false,
    args: typeof msg.args === "string" ? msg.args : typeof msg.input === "string" ? msg.input as string : undefined,
    details: "details" in msg ? msg.details : undefined,
  };
}

export function messageToChatMessage(
  message: unknown,
  id?: string,
  toolCallNameMap?: Record<string, string>,
): ChatMessage | null {
  if (typeof message !== "object" || message === null || !("role" in message)) return null;
  const role = typeof message.role === "string" ? message.role : "";
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return null;

  if (role === "toolResult") {
    const block = parseToolResultBlock(message, toolCallNameMap ?? {});
    if (!block) return null;
    return {
      id: id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "toolResult",
      content: [block],
      timestamp: extractTimestamp(message),
    };
  }

  const msgObj = message as Record<string, unknown>;
  const rawContent = msgObj.content;
  const content = extractContent(rawContent);
  if (content.length === 0) {
    const fallback = typeof rawContent === "string" ? rawContent : undefined;
    if (!fallback) return null;
    content.push({ type: "text", text: fallback });
  }

  const msg: ChatMessage = {
    id: id || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: role as "user" | "assistant",
    content,
    timestamp: extractTimestamp(message),
  };

  if (typeof msgObj.provider === "string") msg.provider = msgObj.provider;
  if (typeof msgObj.model === "string") msg.model = msgObj.model;
  if ("stopReason" in msgObj) msg.stopReason = msgObj.stopReason as string | null;

  const usage = extractTokenUsage(msgObj.usage);
  if (usage) msg.tokenUsage = usage;

  return msg;
}

export function getTextContent(msg: ChatMessage): string {
  return msg.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
}

export { extractTokenUsage, extractTimestamp, extractContent, extractToolCallNameMap };
