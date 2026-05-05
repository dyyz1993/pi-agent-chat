import type { ContentBlock, ChatMessage } from "../src/mainview/types";

export const SID = "test-session-1";
export const TCID = "tc-test-1";

export function makeToolExecBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: TCID,
    toolName: "bash",
    args: "echo hello",
    status: "running",
    ...overrides,
  };
}

export function makeAssistantMsg(
  content: ContentBlock[] = [],
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `msg-assistant-${Date.now()}`,
    role: "assistant",
    content,
    timestamp: Date.now(),
    ...overrides,
  };
}

export function makeUserMsg(text: string): ChatMessage {
  return {
    id: `msg-user-${Date.now()}`,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  };
}

export function makeToolResultMsg(
  toolCallId: string,
  content: string,
  isError = false,
): ChatMessage {
  return {
    id: `msg-result-${Date.now()}`,
    role: "toolResult",
    content: [{ type: "toolResult", toolCallId, toolName: "bash", content, isError }],
    timestamp: Date.now(),
  };
}
