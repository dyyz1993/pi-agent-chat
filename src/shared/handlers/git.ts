import type { RPCServer } from "@dyyz1993/rpc-core";
import type { MethodParams, MethodResult } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { GitFileChange } from "../modules/git";

type RegisterFn = <K extends keyof RPCMethods & string>(
  method: K,
  handler: (params: MethodParams<RPCMethods, K>) => Promise<MethodResult<RPCMethods, K>>,
) => void;

function execGit(args: string[], cwd: string, allowNonZero = false): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0 && !allowNonZero) {
    throw new Error(proc.stderr.toString().trim() || `git ${args[0]} failed`);
  }
  return proc.stdout.toString();
}

function getRepoRoot(cwd: string): string {
  return execGit(["rev-parse", "--show-toplevel"], cwd).trim();
}

function parseStatus(output: string): {
  staged: GitFileChange[];
  changed: GitFileChange[];
  untracked: string[];
} {
  const staged: GitFileChange[] = [];
  const changed: GitFileChange[] = [];
  const untracked: string[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const xy = line.slice(0, 2);
    const filePath = line.slice(3).trim();

    const statusMap: Record<string, "modified" | "added" | "deleted" | "renamed" | "copied"> = {
      M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied",
    };

    // Index (staged) - first char
    const indexStatus = xy[0];
    if (indexStatus !== " " && indexStatus !== "?" && statusMap[indexStatus]) {
      const path = indexStatus === "R" ? filePath.split(" -> ")[1] : filePath;
      staged.push({ path, status: statusMap[indexStatus] });
    }

    // Working tree - second char
    const wtStatus = xy[1];
    if (wtStatus !== " " && wtStatus !== "?" && statusMap[wtStatus]) {
      changed.push({ path: filePath, status: statusMap[wtStatus] });
    }

    // Untracked
    if (xy === "??") {
      untracked.push(filePath);
    }
  }

  return { staged, changed, untracked };
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r: RegisterFn = (method, handler) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("git.status", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const output = execGit(["status", "--porcelain=v1", "--branch"], repoRoot);
    const lines = output.split("\n");

    // Parse branch info from first line
    const branchLine = lines[0] || "";
    const branchMatch = branchLine.match(/^## (.+?)(?:\.\.\.(\S+))?(?:\s+\[(ahead\s+(\d+))?(?:,\s*)?(behind\s+(\d+))?\])?$/);
    const branch = branchMatch?.[1]?.replace("HEAD detached", "").replace(/[()]/g, "").trim() || "unknown";
    const ahead = branchMatch?.[3] ? parseInt(branchMatch[3]) : 0;
    const behind = branchMatch?.[5] ? parseInt(branchMatch[5]) : 0;

    const { staged, changed, untracked } = parseStatus(lines.slice(1).join("\n"));

    return { staged, changed, untracked, branch, ahead, behind };
  });

  r("git.diff", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    let diff = "";
    if (params.staged) {
      diff = execGit(["diff", "--cached", "--", params.filePath], repoRoot);
    } else {
      diff = execGit(["diff", "--", params.filePath], repoRoot);
      if (!diff) {
        try {
          diff = execGit(["diff", "--no-index", "/dev/null", params.filePath], repoRoot, true);
        } catch {
          // ignore
        }
      }
    }

    // Get old content (HEAD version) and new content (working tree)
    let oldContent = "";
    let newContent = "";
    try {
      oldContent = execGit(["show", `HEAD:${params.filePath}`], repoRoot);
    } catch {
      // New file — no old content
    }
    try {
      const { readFile } = await import("fs/promises");
      const { join } = await import("path");
      newContent = (await readFile(join(repoRoot, params.filePath))).toString();
    } catch {
      // Deleted file — no new content
    }

    return { filePath: params.filePath, diff, oldContent, newContent };
  });

  r("git.log", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const count = params.maxCount || 50;
    const output = execGit([
      "log", `--max-count=${count}`,
      "--pretty=format:%H|%h|%s|%an|%aI",
    ], repoRoot);

    const commits = output.split("\n").filter(Boolean).map((line) => {
      const [hash, shortHash, message, author, date] = line.split("|");
      return { hash, shortHash, message, author, date };
    });

    return { commits };
  });

  r("git.commitFiles", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const output = execGit([
      "diff-tree", "--no-commit-id", "--name-status", "-r", params.hash,
    ], repoRoot);

    const statusMap: Record<string, GitFileChange["status"]> = {
      M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied",
    };

    const files: GitFileChange[] = output.split("\n").filter(Boolean).map((line) => {
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t"); // handle paths with tabs (renames: old\tnew)
      return { path: status === "R" ? path.split("\t").pop()! : path, status: statusMap[status] || "modified" };
    });

    return { files };
  });

  r("git.commitFileDiff", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const { hash, filePath } = params;

    // Get the diff for this file in this commit
    const diff = execGit(["diff", `${hash}^..${hash}`, "--", filePath], repoRoot, true);

    // Get old content (parent commit version)
    let oldContent = "";
    try {
      oldContent = execGit(["show", `${hash}^:${filePath}`], repoRoot);
    } catch {
      // File was added in this commit — no old content
    }

    // Get new content (this commit version)
    let newContent = "";
    try {
      newContent = execGit(["show", `${hash}:${filePath}`], repoRoot);
    } catch {
      // File was deleted in this commit — no new content
    }

    return { filePath, diff, oldContent, newContent };
  });

  r("git.branches", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const output = execGit(["branch", "-a", "--no-color"], repoRoot);
    const branches = output.split("\n").filter(Boolean).map((line) => {
      const isCurrent = line.startsWith("*");
      const name = line.replace(/^\*?\s+/, "").trim();
      const isRemote = name.startsWith("remotes/");
      return { name, isCurrent, isRemote };
    });
    return { branches };
  });

  r("git.checkout", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    execGit(["checkout", params.branch], repoRoot);
    return { ok: true };
  });

  r("git.add", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    execGit(["add", ...params.paths], repoRoot);
    return { ok: true };
  });

  r("git.reset", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    execGit(["reset", "HEAD", "--", ...params.paths], repoRoot);
    return { ok: true };
  });

  r("git.commit", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const output = execGit(["commit", "-m", params.message], repoRoot);
    // Extract hash from output like "[main abc1234] message"
    const hashMatch = output.match(/\[[\w\-/.]+\s+([0-9a-f]{7,40})\]/);
    const shortHash = hashMatch?.[1] || "";
    let hash = "";
    if (shortHash) {
      hash = execGit(["rev-parse", shortHash], repoRoot).trim();
    }
    return { hash, shortHash };
  });

  r("git.push", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    execGit(["push"], repoRoot);
    return { ok: true };
  });

  r("git.pull", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    execGit(["pull"], repoRoot);
    return { ok: true };
  });

  r("git.worktreeList", async (params) => {
    const repoRoot = getRepoRoot(params.repoPath);
    const output = execGit(["worktree", "list", "--porcelain"], repoRoot);
    const worktrees: { path: string; branch: string; isMain: boolean }[] = [];
    let current: Partial<typeof worktrees[0]> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push({ path: current.path!, branch: current.branch || "", isMain: !!current.isMain });
        }
        current = { path: line.slice(9), isMain: false };
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.isMain = false;
      } else if (line === "" && current.path) {
        // first worktree is main
        if (worktrees.length === 0) current.isMain = true;
      }
    }
    if (current.path) {
      worktrees.push({ path: current.path!, branch: current.branch || "", isMain: !!current.isMain });
    }

    return { worktrees };
  });
}
