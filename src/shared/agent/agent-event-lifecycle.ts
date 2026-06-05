import {
  compactHoldEventsForReplay,
  HOLD_EVENT_COMPACT_THRESHOLD,
  type SanitizedEvent,
} from "./hold-events";

const INTERACTIVE_EXTENSION_UI_METHODS = new Set(["confirm", "input", "select", "editor"]);

export type ExtensionUiAction =
  | { type: "notify"; payload: { message: string; notifyType: string } }
  | { type: "interactive" }
  | { type: "ignore" };

export function classifyExtensionUiRequest(ui: {
  method?: string;
  message?: string;
  notifyType?: string;
}): ExtensionUiAction {
  if (ui.method === "notify") {
    return {
      type: "notify",
      payload: {
        message: ui.message ?? "",
        notifyType: ui.notifyType ?? "info",
      },
    };
  }
  if (ui.method && INTERACTIVE_EXTENSION_UI_METHODS.has(ui.method)) {
    return { type: "interactive" };
  }
  return { type: "ignore" };
}

export function extractMessageEndText(event: unknown, maxLength = 2000): string | null {
  const candidate = event as {
    type?: string;
    message?: { content?: Array<{ type?: string; text?: string }> };
  };
  if (candidate.type !== "message_end" || !Array.isArray(candidate.message?.content)) {
    return null;
  }

  const text = candidate.message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
    .slice(0, maxLength);
  return text || null;
}

export function appendStreamingHoldEvent(
  status: string,
  holdEvents: SanitizedEvent[],
  event: SanitizedEvent,
  threshold = HOLD_EVENT_COMPACT_THRESHOLD,
): SanitizedEvent[] {
  if (status !== "streaming") return holdEvents;
  const nextEvents = [...holdEvents, event];
  if (nextEvents.length <= threshold) return nextEvents;
  return compactHoldEventsForReplay(nextEvents);
}
