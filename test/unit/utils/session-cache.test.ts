/**
 * @vitest-environment node
 *
 * Tests for SessionMessageReader cache optimization.
 * Validates:
 * 1. Cache capacity supports >10 sessions (expanded to 25)
 * 2. Cache hit rate: after reading N sessions (N > old limit 10), early sessions remain cached
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { SessionMessageReader } from "../../../src/shared/agent/session-message-reader";
import type { SessionMessageReaderDeps } from "../../../src/shared/agent/session-message-reader";

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function makeMessageLine(role: string, text: string, entryId?: string): string {
  return JSON.stringify({
    type: "message",
    id: entryId ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    parentId: null,
    message: {
      role,
      content: [{ type: "text", text }],
    },
  });
}

function makeMessageLineWithParent(
  id: string,
  parentId: string | null,
  role: string,
  text: string,
): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    message: {
      role,
      content: [{ type: "text", text }],
    },
  });
}

function makeLeafPointerLine(leafId: string): string {
  return JSON.stringify({ type: "leaf_pointer", leafId });
}

function makeCustomLine(id: string, parentId: string | null, customType: string): string {
  return JSON.stringify({
    type: "custom",
    id,
    parentId,
    customType,
    data: { ok: true },
  });
}

describe("SessionMessageReader cache", () => {
  let tmpDir: string;
  let deps: SessionMessageReaderDeps;
  let reader: SessionMessageReader;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "session-cache-test-"));
    deps = {
      getActiveManaged: vi.fn().mockReturnValue(undefined),
      resolveSessionPath: vi.fn((sid: string) => join(tmpDir, `${sid}.jsonl`)),
      _getSandboxUserId: vi.fn().mockReturnValue(undefined),
      sessionPaths: new Map(),
      sessionProjectPaths: new Map(),
      clients: new Map(),
      getSandboxManager: vi.fn().mockReturnValue(null),
      leafIds: new Map(),
    };
    reader = new SessionMessageReader(deps);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function writeJsonl(sessionId: string, lines: string[]): string {
    const filePath = join(tmpDir, `${sessionId}.jsonl`);
    writeFileSync(filePath, lines.join("\n"));
    return filePath;
  }

  describe("cache capacity", () => {
    it("SESSION_CACHE_MAX should be >= 25", () => {
      // Verify the constant was increased from 10
      expect(SessionMessageReader.SESSION_CACHE_MAX).toBeGreaterThanOrEqual(25);
    });

    it("should retain early sessions in cache after reading 20 sessions", async () => {
      // Create 20 sessions
      for (let i = 0; i < 20; i++) {
        writeJsonl(`session-${i}`, [
          makeMessageLine("user", `hello ${i}`, `eid-${i}`),
          makeLeafPointerLine(`eid-${i}`),
        ]);
      }

      // Read all 20 to populate cache
      for (let i = 0; i < 20; i++) {
        await reader.getFullMessages(`session-${i}`);
      }

      // Now check session-0 is still cached (would be evicted with old limit=10)
      // getSessionCache returns non-null if cached
      const cache0 = reader.getSessionCache("session-0", join(tmpDir, "session-0.jsonl"));
      expect(cache0).not.toBeNull();
      expect(cache0!.messages.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("streaming memory merge pagination", () => {
    it("keeps merged streaming messages within the requested page and realigns custom entries", async () => {
      const filePath = writeJsonl("session-merge", [
        makeMessageLineWithParent("m1", null, "user", "one"),
        makeCustomLine("c1", "m1", "bash_background_process"),
        makeMessageLineWithParent("m2", "c1", "assistant", "two"),
        makeCustomLine("c2", "m2", "bash_background_process"),
        makeMessageLineWithParent("m3", "c2", "user", "three"),
        makeCustomLine("c3", "m3", "bash_background_process"),
        makeMessageLineWithParent("m4", "c3", "assistant", "four"),
        makeCustomLine("c4", "m4", "bash_background_process"),
        makeLeafPointerLine("c4"),
      ]);
      deps.getActiveManaged = vi.fn().mockReturnValue({
        client: {
          getMessages: vi
            .fn()
            .mockResolvedValue([
              { role: "assistant", content: [{ type: "text", text: "streaming five" }] },
            ]),
        },
        info: {
          status: "streaming",
          sessionPath: filePath,
        },
        _activeSessionId: "session-merge",
      });

      const result = await reader.getFullMessages("session-merge", filePath, { limit: 2 });

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
  });
});
