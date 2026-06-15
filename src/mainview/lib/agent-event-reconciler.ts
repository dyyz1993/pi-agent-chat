import type { ChatMessage, ContentBlock } from "../types";
import {
  findMatchingPendingToolExecution,
  findMatchingToolExecution,
  normalizeToolArgsForMatch,
} from "./tool-execution-reconciler";

export type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

export function hasRenderableContent(msg: ChatMessage): boolean {
  return msg.content.some(
    (b) =>
      (b.type === "text" && b.text.trim().length > 0) ||
      b.type === "thinking" ||
      b.type === "toolCall" ||
      b.type === "toolResult" ||
      b.type === "toolExecution" ||
      b.type === "custom",
  );
}

export function isTerminalToolStatus(status: ToolExecBlock["status"]): boolean {
  return status === "done" || status === "error";
}

export function closeRunningToolExecutions(
  content: ContentBlock[],
  status: "done" | "error",
): ContentBlock[] {
  let changed = false;
  const endedAt = Date.now();
  const next = content.map((block) => {
    if (block.type !== "toolExecution" || block.status !== "running") return block;
    changed = true;
    return {
      ...block,
      status,
      endedAt,
    };
  });
  return changed ? next : content;
}

export function formatToolArgs(rawArgs: unknown): {
  args: string;
  timeout?: number;
  description?: string;
} {
  if (rawArgs && typeof rawArgs === "object" && rawArgs !== null) {
    const obj = rawArgs as Record<string, unknown>;
    const command = typeof obj.command === "string" ? obj.command : undefined;
    const args = command ?? JSON.stringify(rawArgs, null, 2);
    return {
      args,
      timeout: typeof obj.timeout === "number" ? obj.timeout : undefined,
      description: typeof obj.description === "string" ? obj.description : undefined,
    };
  }
  return {
    args:
      typeof rawArgs === "string"
        ? rawArgs
        : rawArgs != null
          ? JSON.stringify(rawArgs, null, 2)
          : "",
  };
}

export { findMatchingPendingToolExecution, findMatchingToolExecution, normalizeToolArgsForMatch };

export function extractIncomingToolCallIds(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "toolCall" &&
      typeof (block as Record<string, unknown>).id === "string"
    ) {
      ids.push((block as Record<string, unknown>).id as string);
    }
  }
  return ids;
}

export function hasTerminalToolExecution(messages: ChatMessage[], toolCallId: string): boolean {
  return messages.some(
    (msg) =>
      msg.role === "assistant" &&
      msg.content.some(
        (block): block is ToolExecBlock =>
          block.type === "toolExecution" &&
          block.toolCallId === toolCallId &&
          isTerminalToolStatus(block.status),
      ),
  );
}

export function isDelayedTerminalMessageUpdate(
  messages: ChatMessage[],
  incomingContent: unknown,
): boolean {
  const incomingToolCallIds = extractIncomingToolCallIds(incomingContent);
  if (incomingToolCallIds.length === 0) return false;

  return incomingToolCallIds.every((toolCallId) => hasTerminalToolExecution(messages, toolCallId));
}
