/**
 * @vitest-environment node
 */
import { appendFileSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  appendUiJsonlEntriesFromPath,
  readFullJsonlAccumulator,
  readFullJsonlAccumulatorCached,
} from "../../../src/shared/agent/session-jsonl-messages";
import { SessionMessageCache } from "../../../src/shared/agent/session-message-cache";

describe("session jsonl message readers", () => {
  it("reads full message accumulator from local JSONL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-jsonl-reader-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user" } }),
        JSON.stringify({ type: "custom", id: "c1", parentId: "u1", customType: "note", data: {} }),
        JSON.stringify({ type: "leaf_pointer", id: "lp", leafId: "u1" }),
      ].join("\n"),
      "utf-8",
    );

    const accumulator = await readFullJsonlAccumulator({ sessionPath });

    expect(accumulator.allMessages).toHaveLength(1);
    expect(accumulator.allCustomEntries).toHaveLength(1);
    expect(accumulator.parentById.get("u1")).toBeNull();
    expect(accumulator.lastJsonlLeafPointer).toBe("u1");
  });

  it("keeps hidden system events out of chat messages but preserves metadata", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-jsonl-system-event-hidden-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user" } }),
        JSON.stringify({
          type: "system_event",
          id: "sys1",
          parentId: "u1",
          timestamp: "2026-01-01T00:00:00Z",
          eventType: "agent_changed",
          eventLabel: "Agent changed to frontend-dev",
          data: { agentName: "frontend-dev" },
          display: false,
        }),
      ].join("\n"),
      "utf-8",
    );

    const accumulator = await readFullJsonlAccumulator({ sessionPath });

    expect(accumulator.allMessages.map((message) => message.entryId)).toEqual(["u1"]);
    expect(accumulator.allCustomEntries).toMatchObject([
      {
        id: "sys1",
        customType: "system_event",
        data: {
          eventType: "agent_changed",
          eventLabel: "Agent changed to frontend-dev",
          data: { agentName: "frontend-dev" },
          display: false,
        },
      },
    ]);
  });

  it("renders displayable system events as custom messages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-jsonl-system-event-display-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      JSON.stringify({
        type: "system_event",
        id: "sys1",
        parentId: null,
        timestamp: "2026-01-01T00:00:00Z",
        eventType: "approval_mode_changed",
        eventLabel: "Approval mode changed to yolo",
        data: { permissionMode: "yolo" },
        display: true,
      }),
      "utf-8",
    );

    const accumulator = await readFullJsonlAccumulator({ sessionPath });

    expect(accumulator.allMessages).toHaveLength(1);
    expect(accumulator.allMessages[0]).toMatchObject({
      entryId: "sys1",
      message: {
        role: "custom",
        customType: "system_event",
        display: true,
        details: {
          eventType: "approval_mode_changed",
          eventLabel: "Approval mode changed to yolo",
          data: { permissionMode: "yolo" },
          display: true,
        },
      },
    });
  });

  it("reads UI entries through sandbox reader when sandbox path is used", async () => {
    const messages: unknown[] = [];
    const customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }> = [];

    await appendUiJsonlEntriesFromPath({
      sessionPath: "/root/workspace/sessions/session.jsonl",
      messages,
      customEntries,
      activePathIds: null,
      includeMessages: true,
      readSandboxFile: async () =>
        [
          JSON.stringify({ type: "message", id: "u1", message: { role: "user" } }),
          JSON.stringify({ type: "custom", id: "c1", customType: "note", data: { ok: true } }),
        ].join("\n"),
    });

    expect(messages).toEqual([{ role: "user" }]);
    expect(customEntries).toMatchObject([{ id: "c1", customType: "note", data: { ok: true } }]);
  });

  it("reuses parsed JSONL data and incrementally reads appended lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-jsonl-reader-cache-"));
    const sessionPath = join(dir, "session.jsonl");
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user" } }),
        JSON.stringify({ type: "leaf_pointer", id: "lp1", leafId: "u1" }),
      ].join("\n") + "\n",
      "utf-8",
    );
    const cache = new SessionMessageCache();

    const first = await readFullJsonlAccumulatorCached({
      sessionId: "sess-1",
      sessionPath,
      getCache: (sessionId, path) => cache.get(sessionId, path),
      setCache: (sessionId, path, data) => cache.set(sessionId, path, data),
    });
    const second = await readFullJsonlAccumulatorCached({
      sessionId: "sess-1",
      sessionPath,
      getCache: (sessionId, path) => cache.get(sessionId, path),
      setCache: (sessionId, path, data) => cache.set(sessionId, path, data),
    });

    expect(first.allMessages).toHaveLength(1);
    expect(second.allMessages).toHaveLength(1);
    expect(second.lastJsonlLeafPointer).toBe("u1");

    appendFileSync(
      sessionPath,
      [
        JSON.stringify({
          type: "message",
          id: "a1",
          parentId: "u1",
          message: { role: "assistant" },
        }),
        JSON.stringify({ type: "leaf_pointer", id: "lp2", leafId: "a1" }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const third = await readFullJsonlAccumulatorCached({
      sessionId: "sess-1",
      sessionPath,
      getCache: (sessionId, path) => cache.get(sessionId, path),
      setCache: (sessionId, path, data) => cache.set(sessionId, path, data),
    });

    expect(third.allMessages.map((m) => m.entryId)).toEqual(["u1", "a1"]);
    expect(third.parentById.get("a1")).toBe("u1");
    expect(third.lastJsonlLeafPointer).toBe("a1");
  });
});
