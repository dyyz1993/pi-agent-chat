/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { register } from "../../../src/shared/handlers/subagent";

const TMP = join(tmpdir(), `pi-subagent-handler-${Date.now()}`);

function makeServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    handlers,
    register(method: string, handler: (params: unknown) => Promise<unknown>) {
      handlers.set(method, handler);
    },
  };
}

function writeJsonl(filePath: string, lines: Array<Record<string, unknown>>) {
  writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
}

beforeEach(() => {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("subagent handler", () => {
  it("lists persisted custom subagent entries from parent session file", async () => {
    const sessionDir = join(TMP, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const parentPath = join(sessionDir, "sess_parent.jsonl");

    writeJsonl(parentPath, [
      {
        type: "session",
        version: 3,
        id: "sess_parent",
        timestamp: new Date().toISOString(),
        cwd: TMP,
      },
      {
        type: "custom",
        customType: "subagent",
        data: {
          sessionId: "sess_sub_001",
          sessionPath: join(sessionDir, "sess_sub_001.jsonl"),
          description: "Generated child",
          instruction: "Do the task",
          startedAt: 1,
        },
      },
    ]);

    const server = makeServer();
    register(server as never, { platform: "web" });

    const handler = server.handlers.get("subagent.listBySession");
    const result = (await handler?.({ sessionPath: parentPath })) as {
      subsessions: Array<{ sessionId: string; description: string }>;
    };

    expect(result.subsessions).toEqual([
      expect.objectContaining({
        sessionId: "sess_sub_001",
        description: "Generated child",
      }),
    ]);
  });

  it("reconstructs subagent children from sibling session files after refresh", async () => {
    const sessionDir = join(TMP, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const parentPath = join(sessionDir, "sess_parent.jsonl");
    const childPath = join(sessionDir, "sess_sub_001.jsonl");

    writeJsonl(parentPath, [
      {
        type: "session",
        version: 3,
        id: "sess_parent",
        timestamp: "2026-06-29T10:00:00.000Z",
        cwd: TMP,
      },
    ]);

    writeJsonl(childPath, [
      {
        type: "session",
        version: 3,
        id: "sess_sub_001",
        timestamp: "2026-06-29T10:01:00.000Z",
        cwd: TMP,
        delegateParentSessionId: "sess_parent",
      },
      {
        type: "delegate_info",
        id: "delegate_info",
        parentId: null,
        timestamp: "2026-06-29T10:01:00.000Z",
        delegateParentSessionId: "sess_parent",
        parentSessionPath: parentPath,
        delegateType: "subagent",
        createdAt: 1719655260000,
      },
      {
        type: "session_info",
        id: "session_info",
        parentId: null,
        timestamp: "2026-06-29T10:01:01.000Z",
        name: "子代理: Child Task",
        cwd: TMP,
      },
      {
        type: "message",
        id: "msg-1",
        timestamp: "2026-06-29T10:01:02.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Child prompt body" }],
        },
      },
    ]);

    const server = makeServer();
    register(server as never, { platform: "web" });

    const handler = server.handlers.get("subagent.listBySession");
    const result = (await handler?.({ sessionPath: parentPath })) as {
      subsessions: Array<{
        sessionId: string;
        sessionPath: string;
        description: string;
        instruction: string;
      }>;
    };

    expect(result.subsessions).toEqual([
      expect.objectContaining({
        sessionId: "sess_sub_001",
        sessionPath: childPath,
        description: "Child Task",
        instruction: "Child prompt body",
      }),
    ]);
  });

  it("merges completed parent custom records even when older entries have an empty sessionPath", async () => {
    const sessionDir = join(TMP, "sessions");
    mkdirSync(sessionDir, { recursive: true });
    const parentPath = join(sessionDir, "sess_parent.jsonl");
    const childPath = join(sessionDir, "sess_sub_001.jsonl");

    writeJsonl(parentPath, [
      {
        type: "session",
        version: 3,
        id: "sess_parent",
        timestamp: "2026-06-29T10:00:00.000Z",
        cwd: TMP,
      },
      {
        type: "custom",
        customType: "subagent",
        data: {
          sessionId: "sess_sub_001",
          sessionPath: "",
          description: "Completed child",
          instruction: "Do the finished task",
          startedAt: 1719655260000,
          completedAt: 1719655360000,
          exitCode: 0,
          finalText: "Finished",
        },
      },
    ]);

    writeJsonl(childPath, [
      {
        type: "session",
        version: 3,
        id: "sess_sub_001",
        timestamp: "2026-06-29T10:01:00.000Z",
        cwd: TMP,
        delegateParentSessionId: "sess_parent",
      },
      {
        type: "delegate_info",
        id: "delegate_info",
        parentId: null,
        timestamp: "2026-06-29T10:01:00.000Z",
        delegateParentSessionId: "sess_parent",
        parentSessionPath: parentPath,
        delegateType: "subagent",
        createdAt: 1719655260000,
      },
    ]);

    const server = makeServer();
    register(server as never, { platform: "web" });

    const handler = server.handlers.get("subagent.listBySession");
    const result = (await handler?.({ sessionPath: parentPath })) as {
      subsessions: Array<{
        sessionId: string;
        sessionPath: string;
        completedAt?: number;
        exitCode?: number;
        finalText?: string;
      }>;
    };

    expect(result.subsessions).toEqual([
      expect.objectContaining({
        sessionId: "sess_sub_001",
        sessionPath: childPath,
        completedAt: 1719655360000,
        exitCode: 0,
        finalText: "Finished",
      }),
    ]);
  });
});
