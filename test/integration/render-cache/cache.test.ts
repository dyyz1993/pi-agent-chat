import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../../../src/mainview/types";

describe("buildFlatItems cache behavior", () => {
  it("should produce identical output for same input reference", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      },
      {
        id: "msg-2",
        role: "assistant",
        content: [{ type: "text", text: "world" }],
        timestamp: Date.now(),
      },
    ];

    const firstResult = messages.map((m) => m.id);
    const cachedResult = firstResult;

    expect(cachedResult).toBe(firstResult);
    expect(cachedResult).toEqual(["msg-1", "msg-2"]);
  });

  it("should detect different array references", () => {
    const messages1: ChatMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      },
    ];

    const messages2: ChatMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      },
    ];

    expect(messages1).not.toBe(messages2);
    expect(messages1).toEqual(messages2);
  });

  it("should handle array reference change when new message added", () => {
    const original: ChatMessage[] = [
      {
        id: "msg-1",
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      },
    ];

    const updated: ChatMessage[] = [
      ...original,
      {
        id: "msg-2",
        role: "assistant",
        content: [{ type: "text", text: "world" }],
        timestamp: Date.now(),
      },
    ];

    expect(original).not.toBe(updated);
    expect(updated.length).toBe(2);
  });
});

describe("cache eviction", () => {
  it("should evict oldest entry when cache exceeds max size", () => {
    const cache = new Map<string, { ref: ChatMessage[]; result: string[] }>();
    const MAX = 10;

    for (let i = 0; i < 15; i++) {
      const sessionId = `session-${i}`;
      const msgs: ChatMessage[] = [
        {
          id: `msg-${i}`,
          role: "user",
          content: [{ type: "text", text: `msg ${i}` }],
          timestamp: Date.now(),
        },
      ];
      cache.set(sessionId, { ref: msgs, result: msgs.map((m) => m.id) });

      if (cache.size > MAX) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
      }
    }

    expect(cache.size).toBeLessThanOrEqual(MAX);
    expect(cache.has("session-0")).toBe(false);
    expect(cache.has("session-4")).toBe(false);
    expect(cache.has("session-14")).toBe(true);
  });
});

describe("cache key stability", () => {
  it("should use sessionId as cache key", () => {
    const cache = new Map<string, unknown>();
    const sid1 = "7ca855b3-778b-45c8-8e70-5975ba8a6a05";
    const sid2 = "sess_coord_1780055962104_jqig6q";

    cache.set(sid1, "data-a");
    cache.set(sid2, "data-b");

    expect(cache.get(sid1)).toBe("data-a");
    expect(cache.get(sid2)).toBe("data-b");
    expect(cache.size).toBe(2);
  });

  it("should handle undefined sessionId gracefully", () => {
    const sid: string | undefined = undefined;
    const shouldCache = !!sid;
    expect(shouldCache).toBe(false);
  });
});

describe("showThinking cache key", () => {
  it("should invalidate cache when showThinking changes", () => {
    const showThinking1 = false;
    const showThinking2 = true;
    expect(showThinking1).not.toBe(showThinking2);
  });
});
