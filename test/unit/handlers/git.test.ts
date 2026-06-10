import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mockFn = vi.fn<(args: string[]) => string>(() => "");
type BunLike = {
  spawnSync?: (cmd: unknown[], options?: unknown) => {
    exitCode: number;
    stdout: Buffer;
    stderr: Buffer;
  };
};
const bunRuntime = ((globalThis as { Bun?: BunLike }).Bun ??= {});
const originalSpawnSync = bunRuntime.spawnSync;

bunRuntime.spawnSync = ((cmd: unknown[]) => {
  const cmdArgs = (Array.isArray(cmd) ? cmd.slice(1) : []) as string[];
  const output = mockFn(cmdArgs);
  if (output.startsWith("ERROR:")) {
    return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(output.slice(6)) };
  }
  return { exitCode: 0, stdout: Buffer.from(output), stderr: Buffer.alloc(0) };
}) as NonNullable<BunLike["spawnSync"]>;

import { register } from "../../../src/shared/handlers/git";

const REPO_PATH = process.cwd();

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    register: vi.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    }),
    handlers,
  };
}

type MockServer = ReturnType<typeof createMockServer>;

describe("git handler", () => {
  let server: MockServer;

  afterAll(() => {
    bunRuntime.spawnSync = originalSpawnSync;
  });

  beforeEach(() => {
    mockFn.mockImplementation((args) => {
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return REPO_PATH;
      return "";
    });
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
  });

  describe("git.status", () => {
    it("parses branch, staged, changed, untracked files", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "status") {
          return [
            "## main...origin/main [ahead 2, behind 1]",
            "M  src/foo.ts",
            " M src/bar.ts",
            "A  src/new.ts",
            "?? untracked.txt",
          ].join("\n");
        }
        if (args[0] === "diff") return "";
        return "";
      });

      const handler = server.handlers.get("git.status")!;
      const result = (await handler({ repoPath: REPO_PATH })) as Record<string, unknown>;

      expect(result.branch).toBe("main");

      const staged = result.staged as Array<Record<string, unknown>>;
      const changed = result.changed as Array<Record<string, unknown>>;
      const untracked = result.untracked as string[];

      expect(staged).toHaveLength(2);
      expect(staged[0].path).toBe("src/foo.ts");
      expect(staged[0].status).toBe("modified");
      expect(staged[1].path).toBe("src/new.ts");
      expect(staged[1].status).toBe("added");

      expect(changed).toHaveLength(1);
      expect(changed[0].path).toBe("src/bar.ts");
      expect(changed[0].status).toBe("modified");

      expect(untracked).toEqual(["untracked.txt"]);
    });

    it("returns unknown branch when branch line is unparseable", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "status") return "HEAD detached at abc1234\n";
        if (args[0] === "diff") return "";
        return "";
      });

      const handler = server.handlers.get("git.status")!;
      const result = (await handler({ repoPath: REPO_PATH })) as Record<string, unknown>;
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });
  });

  describe("git.diff", () => {
    it("returns diff for unstaged file", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "diff" && !args.includes("--cached")) return "diff content here";
        if (args[0] === "show") return "old content";
        return "";
      });

      const handler = server.handlers.get("git.diff")!;
      const result = (await handler({
        repoPath: REPO_PATH,
        filePath: "src/foo.ts",
        staged: false,
      })) as Record<string, unknown>;

      expect(result.filePath).toBe("src/foo.ts");
      expect(result.diff).toBe("diff content here");
    });

    it("returns diff for staged file", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "diff" && args.includes("--cached")) return "staged diff";
        if (args[0] === "show") return "old content";
        return "";
      });

      const handler = server.handlers.get("git.diff")!;
      const result = (await handler({
        repoPath: REPO_PATH,
        filePath: "src/foo.ts",
        staged: true,
      })) as Record<string, unknown>;

      expect(result.diff).toBe("staged diff");
    });
  });

  describe("git.log", () => {
    it("parses commit log entries", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "log") {
          return [
            "abcdef1234567890|abcdef1|feat: add feature|John|2024-01-01T00:00:00Z",
            "1234567890abcdef|12345678|fix: bug fix|Jane|2024-01-02T00:00:00Z",
          ].join("\n");
        }
        return "";
      });

      const handler = server.handlers.get("git.log")!;
      const result = (await handler({ repoPath: REPO_PATH })) as {
        commits: Array<Record<string, string>>;
      };

      expect(result.commits).toHaveLength(2);
      expect(result.commits[0].hash).toBe("abcdef1234567890");
      expect(result.commits[0].shortHash).toBe("abcdef1");
      expect(result.commits[0].message).toBe("feat: add feature");
      expect(result.commits[0].author).toBe("John");
    });

    it("respects maxCount parameter", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "log") {
          expect(args.find((a) => a.startsWith("--max-count="))).toBe("--max-count=10");
          return "";
        }
        return "";
      });

      const handler = server.handlers.get("git.log")!;
      await handler({ repoPath: REPO_PATH, maxCount: 10 });
    });
  });

  describe("git.commitFiles", () => {
    it("parses files changed in a commit", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "diff-tree") {
          return "M\tsrc/foo.ts\nA\tsrc/new.ts\nD\tsrc/old.ts";
        }
        return "";
      });

      const handler = server.handlers.get("git.commitFiles")!;
      const result = (await handler({ repoPath: REPO_PATH, hash: "abc123" })) as {
        files: Array<Record<string, string>>;
      };

      expect(result.files).toHaveLength(3);
      expect(result.files[0]).toEqual({ path: "src/foo.ts", status: "modified" });
      expect(result.files[1]).toEqual({ path: "src/new.ts", status: "added" });
      expect(result.files[2]).toEqual({ path: "src/old.ts", status: "deleted" });
    });
  });

  describe("git.branches", () => {
    it("parses branch list with current and remote markers", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "branch") {
          return "* main\n  develop\n  remotes/origin/main";
        }
        return "";
      });

      const handler = server.handlers.get("git.branches")!;
      const result = (await handler({ repoPath: REPO_PATH })) as {
        branches: Array<Record<string, unknown>>;
      };

      expect(result.branches).toHaveLength(3);
      expect(result.branches[0].isCurrent).toBe(true);
      expect(result.branches[0].isRemote).toBe(false);
      expect(result.branches[2].isRemote).toBe(true);
    });
  });

  describe("git.checkout", () => {
    it("returns ok true on success", async () => {
      const handler = server.handlers.get("git.checkout")!;
      const result = (await handler({ repoPath: REPO_PATH, branch: "develop" })) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ ok: true });
    });
  });

  describe("git.add", () => {
    it("returns ok true on success", async () => {
      const handler = server.handlers.get("git.add")!;
      const result = (await handler({
        repoPath: REPO_PATH,
        paths: ["src/a.ts", "src/b.ts"],
      })) as Record<string, unknown>;
      expect(result).toEqual({ ok: true });
    });
  });

  describe("git.reset", () => {
    it("returns ok true on success", async () => {
      const handler = server.handlers.get("git.reset")!;
      const result = (await handler({ repoPath: REPO_PATH, paths: ["src/a.ts"] })) as Record<
        string,
        unknown
      >;
      expect(result).toEqual({ ok: true });
    });
  });

  describe("git.commit", () => {
    it("parses commit hash from output", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return REPO_PATH;
        if (args[0] === "commit") return "[main abc1234] my commit message\n1 file changed";
        if (args[0] === "rev-parse" && args[1] === "abc1234")
          return "abcdef1234567890abcdef1234567890abcdef12";
        return "";
      });

      const handler = server.handlers.get("git.commit")!;
      const result = (await handler({
        repoPath: REPO_PATH,
        message: "my commit message",
      })) as Record<string, string>;

      expect(result.shortHash).toBe("abc1234");
      expect(result.hash.length).toBeGreaterThan(0);
    });
  });

  describe("git.push", () => {
    it("returns ok true", async () => {
      const handler = server.handlers.get("git.push")!;
      const result = await handler({ repoPath: REPO_PATH });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("git.pull", () => {
    it("returns ok true", async () => {
      const handler = server.handlers.get("git.pull")!;
      const result = await handler({ repoPath: REPO_PATH });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("git.worktreeList", () => {
    it("parses porcelain worktree output", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return REPO_PATH;
        if (args[0] === "worktree") {
          return [
            "worktree /repo",
            "branch refs/heads/main",
            "",
            "worktree /repo-feature",
            "branch refs/heads/feature",
            "",
          ].join("\n");
        }
        return "";
      });

      const handler = server.handlers.get("git.worktreeList")!;
      const result = (await handler({ repoPath: REPO_PATH })) as {
        worktrees: Array<Record<string, unknown>>;
      };

      expect(result.worktrees).toHaveLength(2);
      expect(result.worktrees[0].path).toBe("/repo");
      expect(result.worktrees[0].branch).toBe("main");
      expect(result.worktrees[0].isMain).toBe(true);
      expect(result.worktrees[1].isMain).toBe(false);
    });
  });

  describe("git.worktreeAdd", () => {
    it("returns new worktree info", async () => {
      mockFn.mockImplementation((args) => {
        if (args[0] === "rev-parse") return "/projects/my-repo";
        if (args[0] === "worktree" && args[1] === "add") return "";
        return "";
      });

      const handler = server.handlers.get("git.worktreeAdd")!;
      const result = (await handler({ repoPath: REPO_PATH, branch: "feature-x" })) as {
        worktree: Record<string, unknown>;
      };

      expect(result.worktree.branch).toBe("feature-x");
      expect(result.worktree.isMain).toBe(false);
      expect(typeof result.worktree.path).toBe("string");
      expect((result.worktree.path as string).length).toBeGreaterThan(0);
    });
  });
});
