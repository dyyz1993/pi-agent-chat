/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { readDraft, writeDraft } from "../src/mainview/stores/chat-input-draft";
import { hasSameMessageSnapshots } from "../src/mainview/stores/chat-message-snapshot";
import { isAgentNotStartedError } from "../src/mainview/stores/chat-send-utils";
import type { ChatMessage } from "../src/mainview/types";

const storage = new Map<string, string>();

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
  configurable: true,
});

afterEach(() => {
  storage.clear();
});

describe("chat store helpers", () => {
  it("stores, reads, and clears per-session input drafts", () => {
    writeDraft("sess-1", "hello");
    writeDraft("sess-2", "world");

    expect(readDraft("sess-1")).toBe("hello");
    expect(readDraft("sess-2")).toBe("world");

    writeDraft("sess-1", "");

    expect(readDraft("sess-1")).toBe("");
    expect(readDraft("sess-2")).toBe("world");
  });

  it("compares message snapshots by visible revision fields", () => {
    const current: ChatMessage[] = [
      {
        id: "m1",
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        timestamp: 1,
      },
    ];
    const same: ChatMessage[] = [{ ...current[0], content: [{ type: "text", text: "hello" }] }];
    const changed: ChatMessage[] = [{ ...current[0], content: [{ type: "text", text: "bye" }] }];

    expect(hasSameMessageSnapshots(current, same)).toBe(true);
    expect(hasSameMessageSnapshots(current, changed)).toBe(false);
  });

  it("detects stale agent process send failures for the active session", () => {
    expect(
      isAgentNotStartedError(
        new Error("Agent not started for session sess-123"),
        "sess-123",
      ),
    ).toBe(true);
    expect(
      isAgentNotStartedError(
        new Error("Agent not started for session sess-other"),
        "sess-123",
      ),
    ).toBe(false);
  });
});
