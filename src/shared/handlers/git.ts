import { dirname, basename, join, posix, resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { GitFileChange } from "../modules/git";
import { createLogger } from "../lib/logger";
import type { RemoteProjectRecord } from "../modules/project";
import { listRemoteProjects } from "../lib/project-config";
import { encodeProjectPath, getPiAgentDir, normalizeProjectPath } from "../lib/pi-agent-paths";

const log = createLogger("git");

const EMPTY_STATUS = {
  staged: [] as GitFileChange[],
  changed: [] as GitFileChange[],
  untracked: [] as string[],
  branch: "",
  ahead: 0,
  behind: 0,
};

type GitTarget =
  | { kind: "local"; cwd: string }
  | { kind: "ssh"; cwd: string; remote: RemoteProjectRecord };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function relativeIfInside(basePath: string, candidatePath: string): string | null {
  const base = stripTrailingSlash(basePath);
  const candidate = stripTrailingSlash(candidatePath);
  if (candidate === base) return "";
  const prefix = `${base}/`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : null;
}

function runSshCommand(remote: RemoteProjectRecord, command: string, allowNonZero = false): string {
  const proc = Bun.spawnSync(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      ...(remote.sshArgs ?? []),
      remote.host,
      command,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0 && !allowNonZero) {
    throw new Error(proc.stderr.toString().trim() || "ssh command failed");
  }
  return proc.stdout.toString();
}

async function resolveGitTarget(repoPath: string): Promise<GitTarget> {
  const localPath = resolve(repoPath);
  const remoteProjects = await listRemoteProjects().catch(() => []);
  for (const remote of remoteProjects) {
    const localSuffix = relativeIfInside(resolve(remote.localPath), localPath);
    if (localSuffix !== null) {
      return {
        kind: "ssh",
        cwd: localSuffix ? posix.join(remote.remotePath, localSuffix) : remote.remotePath,
        remote,
      };
    }
    const remoteSuffix = relativeIfInside(remote.remotePath, repoPath);
    if (remoteSuffix !== null) {
      return { kind: "ssh", cwd: repoPath, remote };
    }
  }
  return { kind: "local", cwd: localPath };
}

function execGit(args: string[], target: GitTarget, allowNonZero = false): string {
  if (target.kind === "ssh") {
    const command = `cd ${shellQuote(target.cwd)} && git ${args.map(shellQuote).join(" ")}`;
    return runSshCommand(target.remote, command, allowNonZero);
  }
  const proc = Bun.spawnSync(["git", ...args], {
    cwd: target.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0 && !allowNonZero) {
    throw new Error(proc.stderr.toString().trim() || `git ${args[0]} failed`);
  }
  return proc.stdout.toString();
}

function isGitRepo(target: GitTarget): boolean {
  try {
    return execGit(["rev-parse", "--is-inside-work-tree"], target, true).trim() === "true";
  } catch {
    return false;
  }
}

function getRepoRoot(target: GitTarget): string {
  return execGit(["rev-parse", "--show-toplevel"], target).trim();
}

function sanitizeWorktreeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96) || "worktree";
}

function getDefaultLocalWorktreePath(repoRoot: string, branch: string): string {
  return join(
    getPiAgentDir(),
    "worktrees",
    encodeProjectPath(normalizeProjectPath(repoRoot)),
    sanitizeWorktreeSegment(branch),
  );
}

function readWorktreeFile(target: GitTarget, repoRoot: string, filePath: string): string {
  if (target.kind === "ssh") {
    const command = `cd ${shellQuote(repoRoot)} && cat -- ${shellQuote(filePath)}`;
    return runSshCommand(target.remote, command);
  }
  return readFileSync(join(repoRoot, filePath), "utf8");
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
      M: "modified",
      A: "added",
      D: "deleted",
      R: "renamed",
      C: "copied",
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

function getNumStats(
  target: GitTarget,
  repoRoot: string,
  staged: boolean,
): Map<string, { additions: number; deletions: number }> {
  const stats = new Map<string, { additions: number; deletions: number }>();
  try {
    const args = staged ? ["diff", "--cached", "--numstat"] : ["diff", "--numstat"];
    const output = execGit(args, { ...target, cwd: repoRoot }, true);
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [additions, deletions, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t"); // handle paths with tabs
      if (path && additions !== undefined && deletions !== undefined) {
        // For binary files, additions/deletions are "-"
        const add = additions === "-" ? 0 : parseInt(additions) || 0;
        const del = deletions === "-" ? 0 : parseInt(deletions) || 0;
        stats.set(path, { additions: add, deletions: del });
      }
    }
  } catch (e) {
    log.debug("getNumStats: git diff --numstat failed", { repoRoot, staged, error: String(e) });
  }
  return stats;
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("git.checkRepo", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    return { isGitRepo: isGitRepo(target) };
  });

  r("git.status", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { ...EMPTY_STATUS };
    const repoRoot = getRepoRoot(target);
    const repoTarget = { ...target, cwd: repoRoot };
    const output = execGit(["status", "--porcelain=v1", "--branch"], repoTarget);
    const lines = output.split("\n");

    // Parse branch info from first line
    const branchLine = lines[0] || "";
    const branchMatch = branchLine.match(
      /^## (.+?)(?:\.\.\.(\S+))?(?:\s+\[(ahead\s+(\d+))?(?:,\s*)?(behind\s+(\d+))?\])?$/,
    );
    const branch =
      branchMatch?.[1]?.replace("HEAD detached", "").replace(/[()]/g, "").trim() ?? "unknown";
    const ahead = branchMatch?.[3] ? parseInt(branchMatch[3]) : 0;
    const behind = branchMatch?.[5] ? parseInt(branchMatch[5]) : 0;

    const { staged, changed, untracked } = parseStatus(lines.slice(1).join("\n"));

    // Get line stats for staged and changed files
    const stagedStats = getNumStats(repoTarget, repoRoot, true);
    const changedStats = getNumStats(repoTarget, repoRoot, false);

    // Merge stats into file changes
    for (const f of staged) {
      const stats = stagedStats.get(f.path);
      if (stats) {
        f.additions = stats.additions;
        f.deletions = stats.deletions;
      }
    }
    for (const f of changed) {
      const stats = changedStats.get(f.path);
      if (stats) {
        f.additions = stats.additions;
        f.deletions = stats.deletions;
      }
    }

    return { staged, changed, untracked, branch, ahead, behind };
  });

  r("git.diff", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target))
      return { filePath: params.filePath, diff: "", oldContent: "", newContent: "" };
    const repoRoot = getRepoRoot(target);
    const repoTarget = { ...target, cwd: repoRoot };
    let diff = "";
    if (params.staged) {
      diff = execGit(["diff", "--cached", "--", params.filePath], repoTarget);
    } else {
      diff = execGit(["diff", "--", params.filePath], repoTarget);
      if (!diff) {
        try {
          diff = execGit(["diff", "--no-index", "/dev/null", params.filePath], repoTarget, true);
        } catch (e) {
          log.debug("git.diff: --no-index fallback failed", {
            filePath: params.filePath,
            error: String(e),
          });
        }
      }
    }

    // Get old content (HEAD version) and new content (working tree)
    let oldContent = "";
    let newContent = "";
    try {
      oldContent = execGit(["show", `HEAD:${params.filePath}`], repoTarget);
    } catch {
      log.debug("git.diff: no old content (new file)", { filePath: params.filePath });
    }
    try {
      newContent = readWorktreeFile(repoTarget, repoRoot, params.filePath);
    } catch {
      log.debug("git.diff: no new content (deleted file)", { filePath: params.filePath });
    }

    return { filePath: params.filePath, diff, oldContent, newContent };
  });

  r("git.log", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { commits: [] };
    const repoRoot = getRepoRoot(target);
    const count = params.maxCount ?? 50;
    const output = execGit(["log", `--max-count=${count}`, "--pretty=format:%H|%h|%s|%an|%aI"], {
      ...target,
      cwd: repoRoot,
    });

    const commits = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, message, author, date] = line.split("|");
        return { hash, shortHash, message, author, date };
      });

    return { commits };
  });

  r("git.commitFiles", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { files: [] };
    const repoRoot = getRepoRoot(target);
    const output = execGit(["diff-tree", "--no-commit-id", "--name-status", "-r", params.hash], {
      ...target,
      cwd: repoRoot,
    });

    const statusMap: Record<string, GitFileChange["status"]> = {
      M: "modified",
      A: "added",
      D: "deleted",
      R: "renamed",
      C: "copied",
    };

    const files: GitFileChange[] = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...pathParts] = line.split("\t");
        const path = pathParts.join("\t");
        const resolvedPath = status === "R" ? (path.split("\t").pop() ?? path) : path;
        return { path: resolvedPath, status: statusMap[status] ?? "modified" };
      });

    return { files };
  });

  r("git.commitFileDiff", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target))
      return { filePath: params.filePath, diff: "", oldContent: "", newContent: "" };
    const repoRoot = getRepoRoot(target);
    const repoTarget = { ...target, cwd: repoRoot };
    const { hash, filePath } = params;

    // Get the diff for this file in this commit
    const diff = execGit(["diff", `${hash}^..${hash}`, "--", filePath], repoTarget, true);

    // Get old content (parent commit version)
    let oldContent = "";
    try {
      oldContent = execGit(["show", `${hash}^:${filePath}`], repoTarget);
    } catch {
      log.debug("git.commitFileDiff: no old content (file added in commit)", { hash, filePath });
    }

    // Get new content (this commit version)
    let newContent = "";
    try {
      newContent = execGit(["show", `${hash}:${filePath}`], repoTarget);
    } catch {
      log.debug("git.commitFileDiff: no new content (file deleted in commit)", { hash, filePath });
    }

    return { filePath, diff, oldContent, newContent };
  });

  r("git.branches", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { branches: [] };
    const repoRoot = getRepoRoot(target);
    const output = execGit(["branch", "-a", "--no-color"], { ...target, cwd: repoRoot });
    const branches = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const isCurrent = line.startsWith("*");
        const name = line.replace(/^\*?\s+/, "").trim();
        const isRemote = name.startsWith("remotes/");
        return { name, isCurrent, isRemote };
      });
    return { branches };
  });

  r("git.checkout", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { ok: false };
    const repoRoot = getRepoRoot(target);
    execGit(["checkout", params.branch], { ...target, cwd: repoRoot });
    return { ok: true };
  });

  r("git.add", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { ok: false };
    const repoRoot = getRepoRoot(target);
    execGit(["add", ...params.paths], { ...target, cwd: repoRoot });
    return { ok: true };
  });

  r("git.reset", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { ok: false };
    const repoRoot = getRepoRoot(target);
    execGit(["reset", "HEAD", "--", ...params.paths], { ...target, cwd: repoRoot });
    return { ok: true };
  });

  r("git.commit", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { hash: "", shortHash: "" };
    const repoRoot = getRepoRoot(target);
    const repoTarget = { ...target, cwd: repoRoot };
    const output = execGit(["commit", "-m", params.message], repoTarget);
    // Extract hash from output like "[main abc1234] message"
    const hashMatch = output.match(/\[[\w\-/.]+\s+([0-9a-f]{7,40})\]/);
    const shortHash = hashMatch?.[1] ?? "";
    let hash = "";
    if (shortHash) {
      hash = execGit(["rev-parse", shortHash], repoTarget).trim();
    }
    return { hash, shortHash };
  });

  r("git.push", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { ok: false };
    const repoRoot = getRepoRoot(target);
    execGit(["push"], { ...target, cwd: repoRoot });
    return { ok: true };
  });

  r("git.pull", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { ok: false };
    const repoRoot = getRepoRoot(target);
    execGit(["pull"], { ...target, cwd: repoRoot });
    return { ok: true };
  });

  r("git.worktreeList", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) return { worktrees: [] };
    const repoRoot = getRepoRoot(target);
    const output = execGit(["worktree", "list", "--porcelain"], { ...target, cwd: repoRoot });
    const worktrees: { path: string; branch: string; isMain: boolean }[] = [];
    let current: Partial<(typeof worktrees)[0]> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? "",
            isMain: !!current.isMain,
          });
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
      worktrees.push({
        path: current.path,
        branch: current.branch ?? "",
        isMain: !!current.isMain,
      });
    }

    return { worktrees };
  });

  r("git.worktreeAdd", async (params) => {
    const target = await resolveGitTarget(params.repoPath);
    if (!isGitRepo(target)) throw new Error("Not a git repository");
    const repoRoot = getRepoRoot(target);
    const repoDir = target.kind === "ssh" ? posix.dirname(repoRoot) : dirname(repoRoot);
    const repoName = target.kind === "ssh" ? posix.basename(repoRoot) : basename(repoRoot);
    const newDir =
      target.kind === "ssh"
        ? posix.join(repoDir, `${repoName}-${params.branch}`)
        : getDefaultLocalWorktreePath(repoRoot, params.branch);
    if (target.kind === "local") {
      mkdirSync(dirname(newDir), { recursive: true });
    }
    const args = ["worktree", "add", newDir, "-b", params.branch];
    if (params.sourceBranch) {
      args.push(params.sourceBranch);
    }
    execGit(args, { ...target, cwd: repoRoot });
    return {
      worktree: {
        path: newDir,
        branch: params.branch,
        isMain: false,
      },
    };
  });
}
