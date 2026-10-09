/**
 * ion 事件 → pi AgentEvent 归一化（纯函数，可单测）。
 *
 * 实测对照（contract-matrix.md §3，真 LLM 流）：
 *   agent_start → message_start* → text_delta* → tool_call_delta* →
 *   tool_execution_start/update/end → message_end → agent_end
 *
 * pi 侧差异处理：
 *  - pi 的流式是 message_update{message, assistantMessageEvent}，ion 是扁平
 *    text_delta{delta} —— 这里维护累积 AssistantMessage，每 delta 快照发出；
 *  - pi 有 turn_start/turn_end，ion 没有 —— 在 agent 边界合成；
 *  - ion 特有 tool_call_delta（工具参数流式）Phase 1 忽略；
 *  - extension_event 的 channel_data/custom 映射 Phase 1 不做（capability flag 层面降级）。
 */

import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import type { IonInstanceEvent } from "./ion-types";

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

type AssistantContentItem = TextContentLike | ToolCallLike;

interface AssistantMessageLike {
  role: "assistant";
  content: AssistantContentItem[];
  api: string;
  provider: string;
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  stopReason: string | null;
  timestamp: number;
}

function newAssistantMessage(model?: string, provider?: string): AssistantMessageLike {
  return {
    role: "assistant",
    content: [],
    api: "",
    provider: provider ?? "",
    model: model ?? "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    stopReason: null,
    timestamp: Date.now(),
  };
}

function asAgentEvent(event: unknown): AgentEvent {
  // AgentMessage/AssistantMessageEvent 是精确联合类型；映射产物在字段层面
  // 对齐（role/content/usage/stopReason），在 emit 边界统一收窄。
  return event as AgentEvent;
}

/**
 * 创建事件映射器。每次 agent 轮次内部维护累积状态；
 * 同一 mapper 实例按时间顺序喂入一个订阅流的全部事件。
 */
export function createEventMapper(
  emit: (event: AgentEvent) => void,
): (event: IonInstanceEvent) => void {
  let current: AssistantMessageLike | null = null;

  const startAssistant = (event: IonInstanceEvent): void => {
    current = newAssistantMessage(event.model, event.provider);
    emit(
      asAgentEvent({
        type: "message_start",
        message: { ...current, content: [...current.content] },
      }),
    );
    emit(asAgentEvent({ type: "turn_start" }));
  };

  const finalizeAssistant = (event: IonInstanceEvent, stopReason = "stop"): void => {
    if (!current) return;
    current.stopReason = stopReason;
    current.timestamp = event.timestamp ?? Date.now();
    const usage = event.usage as
      | { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
      | undefined;
    if (usage) {
      current.usage = {
        input: usage.input ?? 0,
        output: usage.output ?? 0,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
      };
    }
    emit(
      asAgentEvent({ type: "message_end", message: { ...current, content: [...current.content] } }),
    );
    current = null;
  };

  return (event: IonInstanceEvent): void => {
    switch (event.type) {
      case "agent_start":
        emit(asAgentEvent({ type: "agent_start" }));
        break;

      case "text_delta": {
        if (!current) startAssistant(event);
        const assistant = current as AssistantMessageLike | null;
        if (assistant && typeof event.delta === "string") {
          const last = assistant.content[assistant.content.length - 1];
          if (last && last.type === "text") {
            last.text += event.delta;
          } else {
            assistant.content.push({ type: "text", text: event.delta });
          }
          emit(
            asAgentEvent({
              type: "message_update",
              message: { ...assistant, content: assistant.content.map((c) => ({ ...c })) },
              assistantMessageEvent: { type: "text_delta", delta: event.delta },
            }),
          );
        }
        break;
      }

      case "tool_call_delta":
        // ion 特有：工具参数流式增量。Phase 1 忽略（前端工具卡用 tool_execution_* 渲染）。
        break;

      case "tool_execution_start":
        // 工具调用开始意味着当前 assistant 文本的流式段落结束（若 ion 未发 message_end）
        if (current) finalizeAssistant(event, "toolUse");
        emit(
          asAgentEvent({
            type: "tool_execution_start",
            toolCallId: event.toolCallId ?? "",
            toolName: event.toolName ?? "",
            args: event.args ?? {},
            timestamp: event.timestamp ?? Date.now(),
          }),
        );
        break;

      case "tool_execution_update":
        emit(
          asAgentEvent({
            type: "tool_execution_update",
            toolCallId: event.toolCallId ?? "",
            toolName: event.toolName ?? "",
            args: event.args ?? {},
            partialResult: event.partialResult ?? null,
          }),
        );
        break;

      case "tool_execution_end": {
        // ion 的 result 是纯字符串/任意值；pi 前端要 AgentToolResult 形状
        // {content:[{type:"text"}], details}（否则 Output 走 JSON.stringify 甚至空）
        const rawResult = event.result ?? null;
        let result: unknown = rawResult;
        if (typeof rawResult === "string") {
          result = { content: [{ type: "text", text: rawResult }], details: undefined };
        } else if (
          rawResult &&
          typeof rawResult === "object" &&
          !Array.isArray((rawResult as { content?: unknown }).content)
        ) {
          result = {
            content: [{ type: "text", text: JSON.stringify(rawResult, null, 2) }],
            details: rawResult,
          };
        }
        emit(
          asAgentEvent({
            type: "tool_execution_end",
            toolCallId: event.toolCallId ?? "",
            toolName: event.toolName ?? "",
            result,
            isError: event.isError ?? false,
            timestamp: event.timestamp ?? Date.now(),
            durationMs: event.durationMs ?? 0,
          }),
        );
        break;
      }

      case "message_start":
        // ion 的 message_start 覆盖 user/assistant/toolResult 多种消息；
        // assistant 流式由首个 text_delta 惰性开启，这里只处理可识别的 assistant 帧。
        if (current) break; // 已在流式中，忽略重复 start
        break;

      case "message_end":
        // ion 的 message_end 带最终 usage/model；只对进行中的 assistant 流式生效
        if (current) finalizeAssistant(event);
        break;

      case "agent_end":
        if (current) finalizeAssistant(event);
        emit(asAgentEvent({ type: "agent_end", messages: [] }));
        break;

      default:
        // extension_event / worker_ready / rpc_response / error 等：Phase 1 不映射
        break;
    }
  };
}
