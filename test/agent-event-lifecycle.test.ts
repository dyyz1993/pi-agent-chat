/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  appendStreamingHoldEvent,
  classifyExtensionUiRequest,
  extractMessageEndText,
} from "../src/shared/agent/agent-event-lifecycle";
import type { SanitizedEvent } from "../src/shared/agent/hold-events";

describe("agent event lifecycle helpers", () => {
  it("classifies extension UI requests into notify, interactive, or ignore", () => {
    expect(
      classifyExtensionUiRequest({
        method: "notify",
        message: "Done",
        notifyType: "success",
      }),
    ).toEqual({
      type: "notify",
      payload: { message: "Done", notifyType: "success" },
    });

    expect(classifyExtensionUiRequest({ method: "confirm" })).toEqual({ type: "interactive" });
    expect(classifyExtensionUiRequest({ method: "input" })).toEqual({ type: "interactive" });
    expect(classifyExtensionUiRequest({ method: "unknown" })).toEqual({ type: "ignore" });
  });

  it("normalizes notify defaults when optional fields are missing", () => {
    expect(classifyExtensionUiRequest({ method: "notify" })).toEqual({
      type: "notify",
      payload: { message: "", notifyType: "info" },
    });
  });

  it("extracts text parts from message_end events and caps long output", () => {
    expect(
      extractMessageEndText({
        type: "message_end",
        message: {
          content: [
            { type: "text", text: "hello " },
            { type: "image", text: "ignored" },
            { type: "text", text: "world" },
          ],
        },
      }),
    ).toBe("hello world");

    expect(
      extractMessageEndText({
        type: "message_end",
        message: { content: [{ type: "text", text: "abcdef" }] },
      }, 3),
    ).toBe("abc");

    expect(extractMessageEndText({ type: "message_update" })).toBeNull();
  });

  it("appends hold events only while streaming", () => {
    const event = { type: "message_update", content: "x" } as SanitizedEvent;

    expect(appendStreamingHoldEvent("idle", [], event)).toEqual([]);
    expect(appendStreamingHoldEvent("streaming", [], event)).toEqual([event]);
  });
});
