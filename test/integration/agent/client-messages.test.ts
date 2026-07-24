/**
 * @vitest-environment node
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getFullMessagesOperation,
  getFullMessagesAroundOperation,
  getMessageNavPageOperation,
  getMessagesOperation,
} from "../../../src/shared/agent/agent-client-message-operations";

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

  it("limits custom entries to the requested message page window", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "old user"),
        customEntry("c1", "m1", "bash_background_process"),
        messageEntry("m2", "c1", "assistant", "old assistant"),
        customEntry("c2", "m2", "bash_background_process"),
        messageEntry("m3", "c2", "user", "new user"),
        customEntry("c3", "m3", "bash_background_process"),
        messageEntry("m4", "c3", "assistant", "new assistant"),
        customEntry("c4", "m4", "bash_background_process"),
      ].join("\n"),
    );
    const leafIds = new Map<string, string | null>([["sess-1", "c4"]]);

    const latest = await getFullMessagesOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds,
      pagination: { limit: 2 },
    });

    expect(latest.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["m3", "m4"]);
    expect(latest.customEntries.map((entry) => entry.id)).toEqual(["c3", "c4"]);
    expect(latest.nextCursor).toBe("m3");

    const previous = await getFullMessagesOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds,
      pagination: {
        limit: 2,
        afterEntryId: latest.nextCursor ?? undefined,
      },
    });

    expect(previous.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["m1", "m2"]);
    expect(previous.customEntries.map((entry) => entry.id)).toEqual(["c1", "c2"]);
  });

  it("loads the oldest page directly without including later custom entries", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "old user"),
        customEntry("c1", "m1", "bash_background_process"),
        messageEntry("m2", "c1", "assistant", "old assistant"),
        customEntry("c2", "m2", "bash_background_process"),
        messageEntry("m3", "c2", "user", "new user"),
        customEntry("c3", "m3", "bash_background_process"),
        messageEntry("m4", "c3", "assistant", "new assistant"),
        customEntry("c4", "m4", "bash_background_process"),
      ].join("\n"),
    );
    const leafIds = new Map<string, string | null>([["sess-1", "c4"]]);

    const result = await getFullMessagesOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds,
      pagination: { limit: 2, fromStart: true },
    });

    expect(result.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["m1", "m2"]);
    expect(result.customEntries.map((entry) => entry.id)).toEqual(["c1", "c2"]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("returns lightweight paginated messages for the side nav index", async () => {
    const largeText = "large-output ".repeat(2_000);
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "old user prompt"),
        jsonlEntry({
          id: "m2",
          parentId: "m1",
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: largeText },
              {
                type: "toolCall",
                id: "tc-bash",
                name: "bash",
                arguments: { command: "printf huge" },
              },
            ],
          },
        }),
        toolResultEntry("m3", "m2", "tc-bash", "bash", largeText),
        messageEntry("m4", "m3", "assistant", "new assistant"),
      ].join("\n"),
    );

    const result = await getMessageNavPageOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map([["sess-1", "m4"]]),
      pagination: { limit: 3 },
    });

    expect(result.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual([
      "m2",
      "m3",
      "m4",
    ]);
    expect(JSON.stringify(result.messages)).not.toContain("large-output");
    expect(JSON.stringify(result.messages)).not.toContain("printf huge");
    expect(result.nextCursor).toBe("m2");
    expect(result.hasMore).toBe(true);
  });

  it("loads newer lightweight side nav messages after a beforeEntryId cursor", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "one"),
        messageEntry("m2", "m1", "assistant", "two"),
        messageEntry("m3", "m2", "user", "three"),
        messageEntry("m4", "m3", "assistant", "four"),
      ].join("\n"),
    );

    const result = await getMessageNavPageOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map([["sess-1", "m4"]]),
      pagination: { limit: 2, beforeEntryId: "m1" },
    });

    expect(result.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["m2", "m3"]);
    expect(result.nextCursor).toBe("m3");
    expect(result.hasMore).toBe(true);
  });

  it("loads a full message window around a side nav target entry", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "one"),
        customEntry("c1", "m1", "bash_background_process"),
        messageEntry("m2", "c1", "assistant", "two"),
        customEntry("c2", "m2", "bash_background_process"),
        messageEntry("m3", "c2", "user", "three"),
        customEntry("c3", "m3", "bash_background_process"),
        messageEntry("m4", "c3", "assistant", "four"),
        customEntry("c4", "m4", "bash_background_process"),
        messageEntry("m5", "c4", "user", "five"),
        customEntry("c5", "m5", "bash_background_process"),
      ].join("\n"),
    );

    const result = await getFullMessagesAroundOperation({
      sessionId: "sess-1",
      sessionPath,
      targetEntryId: "m3",
      before: 1,
      after: 1,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map([["sess-1", "c5"]]),
    });

    expect(result.targetFound).toBe(true);
    expect(result.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual([
      "m2",
      "m3",
      "m4",
    ]);
    expect(result.customEntries.map((entry) => entry.id)).toEqual(["c2", "c3"]);
    expect(result.beforeCursor).toBe("m2");
    expect(result.afterCursor).toBe("m4");
    expect(result.hasMoreBefore).toBe(true);
    expect(result.hasMoreAfter).toBe(true);
  });

  it("returns an empty focus window when the target entry is not in the active branch", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "root"),
        messageEntry("m2", "m1", "assistant", "kept branch"),
        messageEntry("m3", "m1", "assistant", "rolled away branch"),
      ].join("\n"),
    );

    const result = await getFullMessagesAroundOperation({
      sessionId: "sess-1",
      sessionPath,
      targetEntryId: "m3",
      before: 1,
      after: 1,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map([["sess-1", "m2"]]),
    });

    expect(result.targetFound).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.customEntries).toEqual([]);
  });

  it("limits custom entries by file order when no leaf pointer exists", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "old user"),
        customEntry("c1", "m1", "bash_background_process"),
        messageEntry("m2", "c1", "assistant", "old assistant"),
        customEntry("c2", "m2", "bash_background_process"),
        messageEntry("m3", "c2", "user", "new user"),
        customEntry("c3", "m3", "bash_background_process"),
        messageEntry("m4", "c3", "assistant", "new assistant"),
        customEntry("c4", "m4", "bash_background_process"),
      ].join("\n"),
    );

    const latest = await getFullMessagesOperation({
      sessionId: "sess-1",
      sessionPath,
      getActiveManaged: () => null,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map(),
      pagination: { limit: 2 },
    });

    expect(latest.messages.map((m) => (m as { entryId?: string }).entryId)).toEqual(["m3", "m4"]);
    expect(latest.customEntries.map((entry) => entry.id)).toEqual(["c3", "c4"]);
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

  it("keeps streaming memory merge within the requested latest page", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "one"),
        customEntry("c1", "m1", "bash_background_process"),
        messageEntry("m2", "c1", "assistant", "two"),
        customEntry("c2", "m2", "bash_background_process"),
        messageEntry("m3", "c2", "user", "three"),
        customEntry("c3", "m3", "bash_background_process"),
        messageEntry("m4", "c3", "assistant", "four"),
        customEntry("c4", "m4", "bash_background_process"),
      ].join("\n"),
    );
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "assistant", content: [{ type: "text", text: "streaming five" }] },
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
      pagination: { limit: 2 },
    });

    expect(
      result.messages.map((m) =>
        ((m as { content?: Array<{ text?: string }> }).content ?? [])
          .map((block) => block.text ?? "")
          .join(""),
      ),
    ).toEqual(["four", "streaming five"]);
    expect(result.customEntries.map((entry) => entry.id)).toEqual(["c4"]);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("m4");
  });

  it("does not truncate streaming memory merge when no limit is requested", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "one"),
        messageEntry("m2", "m1", "assistant", "two"),
        messageEntry("m3", "m2", "user", "three"),
      ].join("\n"),
    );
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "assistant", content: [{ type: "text", text: "streaming four" }] },
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

    expect(result.messages).toHaveLength(4);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("uses idle active runtime messages when local JSONL has no messages", async () => {
    writeFileSync(sessionPath, "");
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "user", content: [{ type: "text", text: "remote prompt" }] },
          { role: "assistant", content: [{ type: "text", text: "remote answer" }] },
        ]),
      },
      info: {
        status: "idle",
        sessionPath,
      },
    };

    const result = await getFullMessagesOperation({
      sessionId: "sess-1",
      getActiveManaged: () => managed,
      resolveSessionPath: () => sessionPath,
      leafIds: new Map(),
    });

    expect(result.totalCount).toBe(2);
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

  it("does not merge stale in-memory assistant tool calls already completed in JSONL", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "prompt"),
        jsonlEntry({
          id: "m2",
          parentId: "m1",
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tc-commit",
                name: "bash",
                arguments: { description: "commit M7.2.1" },
              },
            ],
          },
        }),
        toolResultEntry("m3", "m2", "tc-commit", "bash", "syntax error"),
      ].join("\n"),
    );
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "user", content: [{ type: "text", text: "prompt" }] },
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "tc-commit",
                name: "bash",
                input: JSON.stringify({ description: "commit M7.2.1" }),
              },
            ],
          },
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

    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((m) => (m as { role?: string }).role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
  });

  it("does not merge stale in-memory assistant text plus completed tool call already completed in JSONL", async () => {
    writeFileSync(
      sessionPath,
      [
        messageEntry("m1", null, "user", "prompt"),
        jsonlEntry({
          id: "m2",
          parentId: "m1",
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I will update the file" },
              {
                type: "toolCall",
                id: "tc-write",
                name: "write",
                arguments: { path: "src/main.ts", content: "export {};" },
              },
            ],
          },
        }),
        toolResultEntry("m3", "m2", "tc-write", "write", "file written"),
      ].join("\n"),
    );
    const managed = {
      client: {
        getMessages: vi.fn().mockResolvedValue([
          { role: "user", content: [{ type: "text", text: "prompt" }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "I will update the file" },
              {
                type: "toolCall",
                id: "tc-write",
                name: "write",
                input: JSON.stringify({ path: "src/main.ts", content: "export {};" }),
              },
            ],
          },
          { role: "assistant", content: [{ type: "text", text: "continuing live response" }] },
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

    expect(result.messages).toHaveLength(4);
    expect(result.messages.map((m) => (m as { role?: string }).role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(
      result.messages.filter((m) => {
        const msg = m as { role?: string; content?: Array<{ type?: string; id?: string }> };
        return (
          msg.role === "assistant" &&
          msg.content?.some((block) => block.type === "toolCall" && block.id === "tc-write")
        );
      }),
    ).toHaveLength(1);
  });

  it("getMessages reads active SDK messages and filters JSONL custom entries by leaf path", async () => {
    writeFileSync(
      sessionPath,
      [customEntry("c1", "m1", "on-path"), customEntry("c2", "other", "off-path")].join("\n"),
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
      [messageEntry("m1", null, "user", "hello"), customEntry("c1", "m1", "file-review-turn")].join(
        "\n",
      ),
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

    expect(result.messages.map((message) => (message as { role?: string }).role)).toEqual(["user"]);
    expect(result.customEntries.map((entry) => entry.customType)).toEqual(["file-review-turn"]);
  });
});
