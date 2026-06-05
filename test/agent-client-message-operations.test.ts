/**
 * @vitest-environment node
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getFullMessagesOperation } from "../src/shared/agent/agent-client-message-operations";

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
});
