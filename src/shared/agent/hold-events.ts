import type { AssistantMessage, AssistantMessageEvent } from "@dyyz1993/pi-ai";
import type { AgentEvent } from "../modules/agent";

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

export type SanitizedEvent =
  | SanitizedMessageUpdate
  | Exclude<AgentEvent, { type: "message_update" }>;

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
