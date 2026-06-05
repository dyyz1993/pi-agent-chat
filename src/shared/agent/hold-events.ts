import type { AssistantMessage, AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { AgentEvent } from "../modules/agent";

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

export type SanitizedEvent =
  | SanitizedMessageUpdate
  | Exclude<AgentEvent, { type: "message_update" }>;

export const HOLD_EVENT_COMPACT_THRESHOLD = 200;

const MESSAGE_UPDATE_REPLAY_KEY = "message_update:open";

type ToolReplayEvent = Extract<
  SanitizedEvent,
  { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }
>;

export function sanitizeEvent(event: AgentEvent): SanitizedEvent {
  if (event.type === "message_update") {
    const { assistantMessageEvent, ...rest } = event;
    const { partial: _, ...ameRest } = assistantMessageEvent as AssistantMessageEvent & {
      partial?: AssistantMessage;
    };
    return { ...rest, assistantMessageEvent: ameRest } as SanitizedMessageUpdate;
  }
  return event as SanitizedEvent;
}

function removeAt<T>(items: T[], index: number): void {
  items.splice(index, 1);
}

function decrementIndexes(indexes: Map<string, number>, removedIndex: number): void {
  for (const [key, index] of indexes) {
    if (index === removedIndex) {
      indexes.delete(key);
    } else if (index > removedIndex) {
      indexes.set(key, index - 1);
    }
  }
}

function replaceOrAppendEvent(
  result: SanitizedEvent[],
  indexes: Map<string, number>,
  key: string,
  event: SanitizedEvent,
): void {
  const existingIndex = indexes.get(key);
  if (existingIndex === undefined) {
    indexes.set(key, result.length);
    result.push(event);
    return;
  }
  result[existingIndex] = event;
}

function removeIndexedEvent(
  result: SanitizedEvent[],
  indexes: Map<string, number>,
  key: string,
): void {
  const index = indexes.get(key);
  if (index === undefined) return;
  removeAt(result, index);
  decrementIndexes(indexes, index);
}

function getToolReplayKey(event: ToolReplayEvent): string {
  return event.toolCallId;
}

/**
 * `holdEvents` is replayed after tab switches and reconnects while an agent is
 * still streaming. Treat it as a resumable state snapshot, not an append-only
 * stream log, otherwise each replay can re-send thousands of stale updates.
 */
export function compactHoldEventsForReplay(events: SanitizedEvent[]): SanitizedEvent[] {
  const result: SanitizedEvent[] = [];
  const indexes = new Map<string, number>();

  for (const event of events) {
    if (event.type === "message_start") {
      removeIndexedEvent(result, indexes, MESSAGE_UPDATE_REPLAY_KEY);
      result.push(event);
      continue;
    }

    if (event.type === "message_update") {
      replaceOrAppendEvent(result, indexes, MESSAGE_UPDATE_REPLAY_KEY, event);
      continue;
    }

    if (event.type === "message_end") {
      removeIndexedEvent(result, indexes, MESSAGE_UPDATE_REPLAY_KEY);
      result.push(event);
      continue;
    }

    if (
      event.type === "tool_execution_start" ||
      event.type === "tool_execution_update" ||
      event.type === "tool_execution_end"
    ) {
      const toolKey = getToolReplayKey(event);
      const startKey = `tool:${toolKey}:start`;
      const updateKey = `tool:${toolKey}:update`;
      const endKey = `tool:${toolKey}:end`;

      if (event.type === "tool_execution_start") {
        if (!indexes.has(endKey)) {
          replaceOrAppendEvent(result, indexes, startKey, event);
        }
        continue;
      }

      if (event.type === "tool_execution_update") {
        if (!indexes.has(endKey)) {
          replaceOrAppendEvent(result, indexes, updateKey, event);
        }
        continue;
      }

      removeIndexedEvent(result, indexes, updateKey);
      replaceOrAppendEvent(result, indexes, endKey, event);
      continue;
    }

    result.push(event);
  }

  return result;
}
