/**
 * ion Rust 枚举消息 → pi RpcAgentMessage 扁平化（纯函数，可单测）。
 *
 * 实测枚举形态（contract-matrix.md §1.3）：
 *   {id, message: {User: {role, content: [{Text: {text}}, {ToolCall: {...}}]}}}
 *   {Assistant: {role, content: [...], model, provider, usage, stopReason, timestamp}}
 *   ToolResult 变体防御式读取。
 */

import type { IonEnumMessage, IonEnumMessageBody } from "./ion-types";

interface TextContentLike {
  type: "text";
  text: string;
}

interface ToolCallLike {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ImageContentLike {
  type: "image";
  data: string;
  mimeType: string;
}

type ContentItem = TextContentLike | ToolCallLike | ImageContentLike;

export interface FlattenedMessage {
  role: "user" | "assistant" | "toolResult";
  content: ContentItem[];
  timestamp: number;
  api: string;
  provider: string;
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  stopReason: string | null;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  entryId?: string;
}

function flattenContent(content: unknown): ContentItem[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const items: ContentItem[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (entry.Text && typeof entry.Text === "object") {
      const text = (entry.Text as { text?: unknown }).text;
      items.push({ type: "text", text: typeof text === "string" ? text : JSON.stringify(text) });
    } else if (entry.ToolCall && typeof entry.ToolCall === "object") {
      const call = entry.ToolCall as { id?: unknown; name?: unknown; arguments?: unknown };
      items.push({
        type: "toolCall",
        id: typeof call.id === "string" ? call.id : "",
        name: typeof call.name === "string" ? call.name : "",
        arguments: (call.arguments as Record<string, unknown>) ?? {},
      });
    } else if (entry.Image && typeof entry.Image === "object") {
      const image = entry.Image as { data?: unknown; mimeType?: unknown };
      items.push({
        type: "image",
        data: typeof image.data === "string" ? image.data : "",
        mimeType: typeof image.mimeType === "string" ? image.mimeType : "image/png",
      });
    }
  }
  return items;
}

function flattenUsage(usage: unknown): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  const u = usage as { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown } | undefined;
  return {
    input: typeof u?.input === "number" ? u.input : 0,
    output: typeof u?.output === "number" ? u.output : 0,
    cacheRead: typeof u?.cacheRead === "number" ? u.cacheRead : 0,
    cacheWrite: typeof u?.cacheWrite === "number" ? u.cacheWrite : 0,
  };
}

function pickBody(envelope: IonEnumMessage): IonEnumMessageBody | null {
  // get_messages 形态：{id, message: {Variant: body}}
  if (envelope.message && typeof envelope.message === "object") {
    for (const value of Object.values(envelope.message)) {
      if (value && typeof value === "object") return value as IonEnumMessageBody;
    }
  }
  // get_full_messages 形态：数组元素直接是 {Variant: body}
  for (const [key, value] of Object.entries(envelope)) {
    if (key === "id") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as IonEnumMessageBody;
    }
  }
  return null;
}

/** 单条枚举消息 → pi 形状；无法识别的变体返回 null（调用方跳过） */
export function flattenIonMessage(envelope: IonEnumMessage): FlattenedMessage | null {
  const body = pickBody(envelope);
  if (!body) return null;
  const content = flattenContent(body.content);
  const timestamp = typeof body.timestamp === "number" ? body.timestamp : Date.now();
  const base = {
    content,
    timestamp,
    api: "",
    provider: typeof body.provider === "string" ? body.provider : "",
    model: typeof body.model === "string" ? body.model : "",
    usage: flattenUsage(body.usage),
    stopReason: typeof body.stopReason === "string" ? body.stopReason : null,
  };
  if (typeof envelope.id === "string") {
    // entryId 是 app 侧树导航/回滚的锚点（ion 的 message entry id）
  }
  if (body.role === "user" || body.role === "assistant") {
    return {
      role: body.role,
      entryId: typeof envelope.id === "string" ? envelope.id : undefined,
      ...base,
    };
  }
  if (body.role === "toolResult" || body.toolCallId !== undefined) {
    return {
      role: "toolResult",
      toolCallId: body.toolCallId ?? "",
      toolName: body.toolName ?? "",
      isError: body.isError ?? false,
      entryId: typeof envelope.id === "string" ? envelope.id : undefined,
      ...base,
    };
  }
  return null;
}

/** get_messages / get_full_messages / get_session_messages 的 messages 数组批量扁平化 */
export function flattenIonMessages(envelopes: unknown): FlattenedMessage[] {
  if (!Array.isArray(envelopes)) return [];
  const out: FlattenedMessage[] = [];
  for (const envelope of envelopes) {
    if (!envelope || typeof envelope !== "object") continue;
    const flattened = flattenIonMessage(envelope as IonEnumMessage);
    if (flattened) out.push(flattened);
  }
  return out;
}
