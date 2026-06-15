import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { register } from "../../../src/shared/handlers/todo";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("todo handler", () => {
  let server: MockServer;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
    tempDir = join(tmpdir(), `todo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("todo.list", () => {
    it("returns empty array for non-existent file", async () => {
      const handler = server.handlers.get("todo.list")!;
      const result = await handler({ sessionPath: "/no/such/file.jsonl" });

      expect(result).toEqual({ todos: [] });
    });

    it("extracts todos from custom type entries", async () => {
      const filePath = join(tempDir, "todos.jsonl");
      const todos = [
        { id: 1, text: "Task A", done: false },
        { id: 2, text: "Task B", done: true },
      ];
      await writeFile(
        filePath,
        [
          JSON.stringify({ type: "session", id: "s1", timestamp: "2025-01-01T00:00:00Z" }),
          JSON.stringify({
            type: "custom",
            customType: "todo",
            id: "c1",
            timestamp: "2025-01-01T00:01:00Z",
            data: { action: "list", todos, nextId: 3 },
          }),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("todo.list")!;
      const result = await handler({ sessionPath: filePath });

      expect(result).toEqual({ todos });
    });

    it("extracts todos from toolResult message entries", async () => {
      const filePath = join(tempDir, "msg-todos.jsonl");
      const todos = [{ id: 1, text: "Do thing", done: false }];
      await writeFile(
        filePath,
        [
          JSON.stringify({ type: "session", id: "s1", timestamp: "2025-01-01T00:00:00Z" }),
          JSON.stringify({
            type: "message",
            id: "m1",
            timestamp: "2025-01-01T00:01:00Z",
            message: {
              role: "toolResult",
              toolName: "todo",
              details: { action: "list", todos, nextId: 2 },
            },
          }),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("todo.list")!;
      const result = await handler({ sessionPath: filePath });

      expect(result).toEqual({ todos });
    });

    it("skips malformed JSON lines gracefully", async () => {
      const filePath = join(tempDir, "malformed.jsonl");
      await writeFile(
        filePath,
        [
          "not json{{{",
          JSON.stringify({
            type: "custom",
            customType: "todo",
            data: { todos: [{ id: 1, text: "valid", done: false }], nextId: 2 },
          }),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("todo.list")!;
      const result = await handler({ sessionPath: filePath });

      expect(result).toEqual({ todos: [{ id: 1, text: "valid", done: false }] });
    });

    it("returns last matching todo list (later entries override)", async () => {
      const filePath = join(tempDir, "override.jsonl");
      await writeFile(
        filePath,
        [
          JSON.stringify({
            type: "custom",
            customType: "todo",
            data: { todos: [{ id: 1, text: "old", done: false }], nextId: 2 },
          }),
          JSON.stringify({
            type: "custom",
            customType: "todo",
            data: { todos: [{ id: 1, text: "new", done: true }], nextId: 2 },
          }),
        ].join("\n") + "\n",
      );

      const handler = server.handlers.get("todo.list")!;
      const result = await handler({ sessionPath: filePath });

      expect(result).toEqual({ todos: [{ id: 1, text: "new", done: true }] });
    });

    it("returns empty when no todo entries exist", async () => {
      const filePath = join(tempDir, "no-todos.jsonl");
      await writeFile(
        filePath,
        JSON.stringify({ type: "session", id: "s1", timestamp: "2025-01-01T00:00:00Z" }) + "\n",
      );

      const handler = server.handlers.get("todo.list")!;
      const result = await handler({ sessionPath: filePath });

      expect(result).toEqual({ todos: [] });
    });
  });
});
