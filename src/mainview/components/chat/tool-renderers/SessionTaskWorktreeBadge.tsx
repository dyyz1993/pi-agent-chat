import { GitBranch } from "lucide-react";
import { useGitStore, type GitWorktree } from "../../../stores/use-git-store";
import { useSessionStore } from "../../../stores/use-session-store";

function basename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.split("/").filter(Boolean).pop() ?? path;
}

function findBestWorktree(projectPath: string, worktrees: GitWorktree[]): GitWorktree | undefined {
  return (
    worktrees.find((wt) => projectPath === wt.path) ??
    [...worktrees]
      .sort((a, b) => b.path.length - a.path.length)
      .find((wt) => projectPath.startsWith(`${wt.path}/`))
  );
}

function resolveSessionProjectPath(sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  const sessionsByProject = useSessionStore.getState().sessionsByProject;
  for (const sessions of Object.values(sessionsByProject)) {
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (session?.projectPath) return session.projectPath;
  }
  return undefined;
}

export function SessionTaskWorktreeBadge({
  projectPath,
  sessionId,
}: {
  projectPath?: string;
  sessionId?: string;
}) {
  const resolvedProjectPath = useSessionStore((s) => {
    if (projectPath) return projectPath;
    if (!sessionId) return undefined;
    for (const sessions of Object.values(s.sessionsByProject)) {
      const session = sessions.find((item) => item.sessionId === sessionId);
      if (session?.projectPath) return session.projectPath;
    }
    return undefined;
  });
  const worktrees = useGitStore((s) => s.worktrees);
  const fallbackPath = resolvedProjectPath ?? resolveSessionProjectPath(sessionId);
  const worktree = fallbackPath ? findBestWorktree(fallbackPath, worktrees) : undefined;
  const label = worktree
    ? worktree.isMain
      ? basename(worktree.path)
      : worktree.branch
    : basename(fallbackPath);

  if (!label) return null;

  const title = worktree
    ? `${worktree.isMain ? "main" : worktree.branch} · ${worktree.path}`
    : fallbackPath;

  return (
    <span
      title={title}
      className="hidden sm:inline-flex shrink min-w-0 max-w-28 lg:max-w-40 items-center gap-1 truncate rounded border border-semantic-tool/20 bg-semantic-tool/10 px-1.5 py-0.5 text-[10px] text-semantic-tool"
    >
      <GitBranch className="h-3 w-3 shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </span>
  );
}
