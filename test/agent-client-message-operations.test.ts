/**
 * @vitest-environment node
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getFullMessagesOperation,
  getMessagesOperation,
} from "../src/shared/agent/agent-client-message-operations";

const TMP_ROOT = join(tmpdir(), "pi-agent-message-ops-test");

function jsonlEntry(entry: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
}

function messageEntry(id: string, parentId: string | null, role: string, text: string): string {
  return jsonlEntry({
    id,
    parentId,
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  });
}

function toolResultEntry(
  id: string,
  parentId: string | null,
  toolCallId: string,
  toolName: string,
  text: string,
): string {
  return jsonlEntry({
    id,
    parentId,
    type: "message",
    message: {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError: false,
    },
  });
}

function customEntry(id: string, parentId: string | null, customType: string): string {
  return jsonlEntry({
    id,
    parentId,
    type: "custom",
    customType,
    data: { ok: true },
  });
}

describe("agent client message operations", () => {
  let sessionPath: string;

  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
    sessionPath = join(TMP_ROOT, `session-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("reads JSONL messages, applies leaf pointer filtering, and updates leaf cache", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "root"),
        messageEntry("m2", "m1", "assistant", "reply"),
        messageEntry("m3", "m2", "user", "old branch"),
        messageEntry("m4", "m2", "user", "new branch"),
        jsonlEntry({ id: "leaf-1", type: "leaf_pointer", leafId: "m4" }),
      ].join("\n"),
    );
    const leafIds = new Map<string, string | null>();

    const result = await getFullMessagesOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds,
    });

    expect(leafIds.get("sess-1")).toBe("m4");
    expect(result.messages.map((m) => (m as { role?: string }).role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(result.totalCount).toBe(3);
  });

  it("merges streaming in-memory messages without duplicating persisted user text", async () => {
    writeFileSync(sessionPath, messageEntry("m1", null, "user", "already persisted"));
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "user", content: [{ type: "text", text: "already persisted" }] },
          { entryId: "m2", role: "assistant", content: [{ type: "text", text: "streaming" }] },
        ]),
      },
      info: {
        status: "streaming",
        sessionPath,
      },
    };

    const result = await getFullMessagesOperation({
      sessionId: "sess-1",
      getActiveManaged: () => managed,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map(),
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => (m as { role?: string }).role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("does not duplicate persisted assistant and tool results during streaming memory merge", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "prompt"),
        messageEntry("m2", "m1", "assistant", "I will read a file"),
        toolResultEntry("m3", "m2", "tc-read", "read", "file content"),
      ].join("\n"),
    );
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "user", content: [{ type: "text", text: "prompt" }] },
          { role: "assistant", content: [{ type: "text", text: "I will read a file" }] },
          {
            role: "toolResult",
            toolCallId: "tc-read",
            toolName: "read",
            content: [{ type: "text", text: "file content" }],
            isError: false,
          },
          { role: "assistant", content: [{ type: "text", text: "still streaming" }] },
        ]),
      },
      info: {
        status: "streaming",
        sessionPath,
      },
    };

    const result = await getFullMessagesOperation({
      sessionId: "sess-1",
      getActiveManaged: () => managed,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map(),
    });

    expect(result.totalCount).toBe(3);
    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => (m as { role?: string }).role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(
      result.messages.filter(
        (m) => (m as { role?: string; toolCallId?: string }).toolCallId === "tc-read",
      ),
    ).toHaveLength(1);
  });

  it("getMessages reads active SDK messages and filters JSONL custom entries by leaf path", async () => {
    writeFileSync(
      sessionPath,
      [
        customEntry("c1", "m1", "on-path"),
        customEntry("c2", "other", "off-path"),
      ].join("\n"),
    );
    const leafIds = new Map<string, string | null>();
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([{ role: "assistant", content: "live" }]),
        getTreeWithLeaf: vi.fn().mockResolvedValue({
          entries: [
            { id: "m1", parentId: null, type: "message" },
            { id: "c1", parentId: "m1", type: "custom" },
          ],
          leafId: "c1",
        }),
      },
      info: {
        status: "idle",
        sessionPath,
      },
    };

    const result = await getMessagesOperation({
      sessionId: "sess-1",
      getActiveManaged: () => managed,
      resolveSessionPath: () => "",
      readJsonlEntries: vi.fn(),
      buildMessagesFromJsonl: vi.fn(),
      leafIds,
    });

    expect(leafIds.get("sess-1")).toBe("c1");
    expect(result.messages).toEqual([{ role: "assistant", content: "live" }]);
    expect(result.customEntries.map((entry) => entry.customType)).toEqual(["on-path"]);
  });

  it("getMessages reads inactive JSONL messages and custom entries", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "hello"),
        customEntry("c1", "m1", "file-review-turn"),
      ].join("\n"),
    );

    const result = await getMessagesOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      readJsonlEntries: vi.fn().mockResolvedValue([
        { id: "m1", parentId: null, type: "message" },
        { id: "c1", parentId: "m1", type: "custom", customType: "file-review-turn" },
      ]),
      buildMessagesFromJsonl: vi.fn().mockReturnValue([]),
      leafIds: new Map([["sess-1", "c1"]]),
    });

    expect(result.messages.map((message) => (message as { role?: string }).role)).toEqual([
      "user",
    ]);
    expect(result.customEntries.map((entry) => entry.customType)).toEqual(["file-review-turn"]);
  });
});
