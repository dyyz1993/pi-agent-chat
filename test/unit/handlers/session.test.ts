import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../../src/shared/lib/project-config", () => ({
  pinSession: vi.fn(async () => ["sess-1"]),
  unpinSession: vi.fn(async () => []),
  listPinnedSessionIds: vi.fn(async () => []),
}));

import { register } from "../../../src/shared/handlers/session";
import { unpinSession } from "../../../src/shared/lib/project-config";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("session handler", () => {
  let server: MockServer;
  let tempDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = join(tmpdir(), `session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tempDir, "agent");
    await mkdir(tempDir, { recursive: true });
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
  });

  afterEach(async () => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("session.create", () => {
    it("creates a session file and returns sessionId + sessionPath", async () => {
      const handler = server.handlers.get("session.create")!;
      const result = (await handler({ projectPath: "/test/project" })) as {
        sessionId: string;
        sessionPath: string;
      };

      expect(result.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.sessionPath).toContain(result.sessionId);
      expect(result.sessionPath).toContain(".jsonl");
      expect(result.sessionPath).toContain(join(process.env.PI_CODING_AGENT_DIR!, "sessions"));
      expect(existsSync(result.sessionPath)).toBe(true);
    });

    it("writes valid JSONL header", async () => {
      const handler = server.handlers.get("session.create")!;
      const result = (await handler({ projectPath: "/test/project" })) as {
        sessionId: string;
        sessionPath: string;
      };

      const { readFile } = await import("fs/promises");
      const content = await readFile(result.sessionPath, "utf-8");
      const header = JSON.parse(content.split("\n")[0]);

      expect(header.type).toBe("session");
      expect(header.version).toBe(1);
      expect(header.id).toBe(result.sessionId);
      expect(header.cwd).toBe("/test/project");
    });
  });

  describe("session.getEntries", () => {
    it("returns empty entries for non-existent file", async () => {
      const handler = server.handlers.get("session.getEntries")!;
      const result = await handler({ sessionPath: "/no/such/file.jsonl" });

      expect(result).toEqual({ entries: [], hasMore: false });
    });

    it("parses JSONL entries correctly", async () => {
      const filePath = join(tempDir, "test.jsonl");
      await writeFile(
        filePath,
        [
          JSON.stringify({ type: "session", id: "s1", timestamp: "2025-01-01T00:00:00Z" }),
          JSON.stringify({
            type: "message",
            id: "m1",
            parentId: null,
            timestamp: "2025-01-01T00:01:00Z",
            role: "user",
          }),
          "",
          JSON.stringify({
            type: "message",
            id: "m2",
            parentId: "m1",
            timestamp: "2025-01-01T00:02:00Z",
            role: "assistant",
          }),
        ].join("\n"),
      );

      const handler = server.handlers.get("session.getEntries")!;
      const result = (await handler({ sessionPath: filePath })) as {
        entries: Array<{ id: string; type: string }>;
      };

      expect(result.entries).toHaveLength(3);
      expect(result.entries[0].id).toBe("s1");
      expect(result.entries[1].id).toBe("m1");
      expect(result.entries[2].id).toBe("m2");
    });

    it("skips malformed JSON lines", async () => {
      const filePath = join(tempDir, "malformed.jsonl");
      await writeFile(
        filePath,
        [
          JSON.stringify({ type: "session", id: "s1", timestamp: "2025-01-01T00:00:00Z" }),
          "not valid json{{{",
          JSON.stringify({ type: "message", id: "m1", timestamp: "2025-01-01T00:01:00Z" }),
        ].join("\n"),
      );

      const handler = server.handlers.get("session.getEntries")!;
      const result = (await handler({ sessionPath: filePath })) as {
        entries: Array<{ id: string }>;
      };

      expect(result.entries).toHaveLength(2);
    });
  });

  describe("session.delete", () => {
    it("deletes existing session file", async () => {
      const filePath = join(tempDir, "to-delete.jsonl");
      await writeFile(filePath, JSON.stringify({ type: "session", id: "del-1" }) + "\n");

      const handler = server.handlers.get("session.delete")!;
      const result = await handler({ sessionPath: filePath, sessionId: "del-1" });

      expect(result).toEqual({ ok: true });
      expect(existsSync(filePath)).toBe(false);
    });

    it("unpins session on delete", async () => {
      const filePath = join(tempDir, "pinned.jsonl");
      await writeFile(filePath, "{}\n");

      const handler = server.handlers.get("session.delete")!;
      await handler({ sessionPath: filePath, sessionId: "pinned-1" });

      expect(unpinSession).toHaveBeenCalledWith("pinned-1");
    });

    it("returns ok:false for non-existent file", async () => {
      const handler = server.handlers.get("session.delete")!;
      const result = await handler({ sessionPath: "/no/such/file.jsonl", sessionId: "ghost" });

      expect(result).toEqual({ ok: false });
    });
  });

  describe("session.rename", () => {
    it("appends session_info entry when none exists", async () => {
      const filePath = join(tempDir, "rename.jsonl");
      await writeFile(
        filePath,
        JSON.stringify({
          type: "session",
          id: "s1",
          version: 1,
          timestamp: "2025-01-01T00:00:00Z",
          cwd: "/test",
        }) + "\n",
      );

      const handler = server.handlers.get("session.rename")!;
      const result = await handler({ sessionPath: filePath, newName: "My Session" });

      expect(result).toEqual({ ok: true });

      const { readFile } = await import("fs/promises");
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const lastEntry = JSON.parse(lines[lines.length - 1]);

      expect(lastEntry.type).toBe("session_info");
      expect(lastEntry.name).toBe("My Session");
    });

    it("updates existing session_info name", async () => {
      const filePath = join(tempDir, "rename-existing.jsonl");
      await writeFile(
        filePath,
        [
          JSON.stringify({
            type: "session",
            id: "s1",
            version: 1,
            timestamp: "2025-01-01T00:00:00Z",
            cwd: "/test",
          }),
          JSON.stringify({
            type: "session_info",
            id: "si1",
            parentId: null,
            timestamp: "2025-01-01T00:01:00Z",
            name: "Old Name",
          }),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("session.rename")!;
      const result = await handler({ sessionPath: filePath, newName: "New Name" });

      expect(result).toEqual({ ok: true });

      const { readFile } = await import("fs/promises");
      const content = await readFile(filePath, "utf-8");
      const infoLine = content
        .split("\n")
        .filter((l) => l.trim())
        .find((l) => {
          try {
            return JSON.parse(l).type === "session_info";
          } catch {
            return false;
          }
        });
      const info = JSON.parse(infoLine!);
      expect(info.name).toBe("New Name");
    });

    it("returns ok:false for non-existent file", async () => {
      const handler = server.handlers.get("session.rename")!;
      const result = await handler({ sessionPath: "/no/such/file.jsonl", newName: "x" });

      expect(result).toEqual({ ok: false });
    });
  });

  describe("session.updateCwd", () => {
    it("updates cwd in existing session_info", async () => {
      const filePath = join(tempDir, "update-cwd.jsonl");
      await writeFile(
        filePath,
        [
          JSON.stringify({
            type: "session",
            id: "s1",
            version: 1,
            timestamp: "2025-01-01T00:00:00Z",
            cwd: "/old",
          }),
          JSON.stringify({
            type: "session_info",
            id: "si1",
            parentId: null,
            timestamp: "2025-01-01T00:01:00Z",
            cwd: "/old",
          }),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("session.updateCwd")!;
      const result = await handler({ sessionPath: filePath, newCwd: "/new/path" });

      expect(result).toEqual({ ok: true });

      const { readFile } = await import("fs/promises");
      const content = await readFile(filePath, "utf-8");
      const infoLine = content
        .split("\n")
        .filter((l) => l.trim())
        .find((l) => {
          try {
            return JSON.parse(l).type === "session_info";
          } catch {
            return false;
          }
        });
      const info = JSON.parse(infoLine!);
      expect(info.cwd).toBe("/new/path");
    });

    it("returns ok:false for non-existent file", async () => {
      const handler = server.handlers.get("session.updateCwd")!;
      const result = await handler({ sessionPath: "/no/such/file.jsonl", newCwd: "/x" });

      expect(result).toEqual({ ok: false });
    });
  });
});
