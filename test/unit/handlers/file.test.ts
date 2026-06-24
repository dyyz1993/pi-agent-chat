import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const mocks = vi.hoisted(() => ({
  listRemoteProjects: vi.fn(),
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  listRemoteProjects: mocks.listRemoteProjects,
}));

type BunLike = {
  spawnSync?: (cmd: unknown[], options?: unknown) => {
    exitCode: number;
    stdout: Buffer;
    stderr: Buffer;
  };
};
const bunRuntime = ((globalThis as { Bun?: BunLike }).Bun ??= {});
const originalSpawnSync = bunRuntime.spawnSync;

import { register } from "../../../src/shared/handlers/file";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("file handler", () => {
  let server: MockServer;
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.listRemoteProjects.mockResolvedValue([]);
    bunRuntime.spawnSync = originalSpawnSync;
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
    tempDir = join(tmpdir(), `file-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    bunRuntime.spawnSync = originalSpawnSync;
  });

  describe("file.readFile", () => {
    it("reads file content and size", async () => {
      const filePath = join(tempDir, "read.txt");
      const content = "Hello, World!";
      await writeFile(filePath, content, "utf-8");

      const handler = server.handlers.get("file.readFile")!;
      const result = (await handler({ path: filePath })) as {
        content: string;
        size: number;
      };

      expect(result.content).toBe(content);
      expect(result.size).toBe(Buffer.byteLength(content, "utf-8"));
    });

    it("throws for non-existent file", async () => {
      const handler = server.handlers.get("file.readFile")!;

      await expect(handler({ path: join(tempDir, "nope.txt") })).rejects.toThrow();
    });
  });

  describe("file.writeFile", () => {
    it("writes content to file", async () => {
      const filePath = join(tempDir, "write.txt");

      const handler = server.handlers.get("file.writeFile")!;
      const result = await handler({ path: filePath, content: "test content" });

      expect(result).toEqual({ ok: true });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("test content");
    });

    it("overwrites existing file", async () => {
      const filePath = join(tempDir, "overwrite.txt");
      await writeFile(filePath, "old", "utf-8");

      const handler = server.handlers.get("file.writeFile")!;
      await handler({ path: filePath, content: "new" });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("new");
    });
  });

  describe("file.editFile", () => {
    it("replaces old text with new text", async () => {
      const filePath = join(tempDir, "edit.txt");
      await writeFile(filePath, "Hello old world", "utf-8");

      const handler = server.handlers.get("file.editFile")!;
      const result = await handler({
        path: filePath,
        edits: [{ oldText: "old", newText: "new" }],
      });

      expect(result).toEqual({ ok: true });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("Hello new world");
    });

    it("skips edit when oldText not found", async () => {
      const filePath = join(tempDir, "edit-miss.txt");
      await writeFile(filePath, "original", "utf-8");

      const handler = server.handlers.get("file.editFile")!;
      await handler({
        path: filePath,
        edits: [{ oldText: "nonexistent", newText: "replaced" }],
      });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("original");
    });

    it("applies multiple edits in order", async () => {
      const filePath = join(tempDir, "multi-edit.txt");
      await writeFile(filePath, "aaa bbb ccc", "utf-8");

      const handler = server.handlers.get("file.editFile")!;
      await handler({
        path: filePath,
        edits: [
          { oldText: "aaa", newText: "xxx" },
          { oldText: "bbb", newText: "yyy" },
        ],
      });

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("xxx yyy ccc");
    });
  });

  describe("file.createFile", () => {
    it("creates an empty file", async () => {
      const handler = server.handlers.get("file.createFile")!;
      const result = (await handler({ dirPath: tempDir, name: "new.txt" })) as {
        path: string;
      };

      expect(result.path).toBe(join(tempDir, "new.txt"));
      expect(existsSync(result.path)).toBe(true);

      const content = await readFile(result.path, "utf-8");
      expect(content).toBe("");
    });
  });

  describe("file.createDir", () => {
    it("creates a directory", async () => {
      const handler = server.handlers.get("file.createDir")!;
      const result = (await handler({ dirPath: tempDir, name: "subdir" })) as {
        path: string;
      };

      expect(result.path).toBe(join(tempDir, "subdir"));
      expect(existsSync(result.path)).toBe(true);
    });
  });

  describe("file.rename", () => {
    it("renames a file", async () => {
      const oldPath = join(tempDir, "old.txt");
      await writeFile(oldPath, "data", "utf-8");

      const handler = server.handlers.get("file.rename")!;
      const result = (await handler({ oldPath, newName: "new.txt" })) as {
        newPath: string;
      };

      expect(result.newPath).toBe(join(tempDir, "new.txt"));
      expect(existsSync(result.newPath)).toBe(true);
      expect(existsSync(oldPath)).toBe(false);
    });
  });

  describe("file.delete", () => {
    it("deletes a file", async () => {
      const filePath = join(tempDir, "delete-me.txt");
      await writeFile(filePath, "bye", "utf-8");

      const handler = server.handlers.get("file.delete")!;
      const result = await handler({ path: filePath });

      expect(result).toEqual({ ok: true });
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe("file.copy", () => {
    it("copies a file to destination", async () => {
      const srcPath = join(tempDir, "src.txt");
      await writeFile(srcPath, "copy me", "utf-8");
      const destDir = join(tempDir, "dest");
      await mkdir(destDir, { recursive: true });

      const handler = server.handlers.get("file.copy")!;
      const result = (await handler({ srcPath, destDir })) as { path: string };

      expect(result.path).toBe(join(destDir, "src.txt"));
      const content = await readFile(result.path, "utf-8");
      expect(content).toBe("copy me");
    });
  });

  describe("file.listDir", () => {
    it("lists directory entries", async () => {
      await writeFile(join(tempDir, "a.txt"), "a");
      await mkdir(join(tempDir, "sub"));

      const handler = server.handlers.get("file.listDir")!;
      const result = (await handler({ path: tempDir })) as {
        entries: Array<{ name: string; type: string }>;
      };

      expect(result.entries.length).toBeGreaterThanOrEqual(2);
      const names = result.entries.map((e) => e.name);
      expect(names).toContain("a.txt");
      expect(names).toContain("sub");
    });

    it("returns empty for non-existent directory", async () => {
      const handler = server.handlers.get("file.listDir")!;
      const result = (await handler({ path: "/no/such/dir" })) as {
        entries: unknown[];
      };

      expect(result.entries).toEqual([]);
    });

    it("lists remote entries for SSH shadow project paths", async () => {
      mocks.listRemoteProjects.mockResolvedValue([
        {
          id: "remote-demo",
          name: "demo1",
          runtime: "ssh",
          sshRuntimeKind: "remote-agent-child",
          profileId: "profile-1",
          host: "devbox",
          remotePath: "/Users/xyz/Projects/demo1",
          localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-demo",
          sshArgs: ["-p", "2222"],
          createdAt: 1,
          lastOpened: 1,
        },
      ]);
      bunRuntime.spawnSync = ((cmd: unknown[]) => {
        const args = (Array.isArray(cmd) ? cmd : []) as string[];
        const command = args.at(-1) ?? "";
        expect(args).toContain("devbox");
        expect(args).toContain("2222");
        expect(command).toContain("python3 -c");
        expect(command).toContain("'/Users/xyz/Projects/demo1'");
        return {
          exitCode: 0,
          stdout: Buffer.from(
            JSON.stringify({
              basePath: "/Users/xyz/Projects/demo1",
              entries: [
                {
                  name: "pi-agent-app",
                  path: "/Users/xyz/Projects/demo1/pi-agent-app",
                  type: "directory",
                  size: 128,
                  isIgnored: false,
                },
              ],
            }),
          ),
          stderr: Buffer.alloc(0),
        };
      }) as NonNullable<BunLike["spawnSync"]>;

      const handler = server.handlers.get("file.listDir")!;
      const result = (await handler({
        path: "/Users/me/.pi-agent-chat/remote-projects/ssh-demo",
      })) as {
        basePath: string;
        entries: Array<{ name: string; path: string; type: string }>;
      };

      expect(result.basePath).toBe("/Users/xyz/Projects/demo1");
      expect(result.entries).toEqual([
        {
          name: "pi-agent-app",
          path: "/Users/xyz/Projects/demo1/pi-agent-app",
          type: "directory",
          size: 128,
          isIgnored: false,
        },
      ]);
    });
  });
});
