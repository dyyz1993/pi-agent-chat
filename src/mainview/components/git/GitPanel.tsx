import { memo, useEffect, useCallback, useState, useRef } from "react";
import {
  GitBranch,
  RefreshCw,
  FileQuestion,
  Plus,
  Minus,
  Pencil,
  ChevronRight,
  ChevronDown,
  Eye,
  FileText,
  Copy,
  Upload,
  Download,
  ChevronUp,
  ChevronDown as BranchChevron,
  FolderTree,
} from "lucide-react";
import { useGitStore, type GitFileChange, type GitCommit } from "../../stores/use-git-store";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useSessionStore } from "../../stores/use-session-store";
import { ContextMenu, type MenuItem } from "../explorer/ContextMenu";
import { GitCommitInput } from "./GitCommitInput";
import { GitBranchSelector } from "./GitBranchSelector";
import { PinButton } from "../sidebar/PinButton";
import { formatFilePath } from "../../lib/format-path";
import { AnchoredPopover, useCopyFeedback } from "../primitives";

/* ── Helpers ────────────────────────────────────────────── */

function statusIcon(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return <Plus className="w-3 h-3 text-status-success" />;
    case "deleted":
      return <Minus className="w-3 h-3 text-status-error" />;
    case "modified":
      return <Pencil className="w-3 h-3 text-status-warning" />;
    default:
      return <FileQuestion className="w-3 h-3 text-text-tertiary" />;
  }
}

function statusLabel(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "copied":
      return "C";
  }
}

function statusColor(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return "text-status-success bg-status-success/10";
    case "deleted":
      return "text-status-error bg-status-error/10";
    case "modified":
      return "text-status-warning bg-status-warning/10";
    case "renamed":
      return "text-status-info bg-status-info/10";
    case "copied":
      return "text-semantic-tool bg-semantic-tool/10";
  }
}

function countByStatus(files: GitFileChange[]) {
  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0, copied: 0 };
  for (const f of files) {
    counts[f.status]++;
  }
  return counts;
}

function formatChangeSummary(files: GitFileChange[]): string {
  const counts = countByStatus(files);
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} added`);
  if (counts.modified > 0) parts.push(`${counts.modified} modified`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} deleted`);
  if (counts.renamed > 0) parts.push(`${counts.renamed} renamed`);
  if (counts.copied > 0) parts.push(`${counts.copied} copied`);
  return parts.join(", ");
}

function relativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

/* ── Sub-components ─────────────────────────────────────── */

/* Working file item (staged / changed) with stage/unstage button */
interface FileItemProps {
  path: string;
  status: GitFileChange["status"];
  additions?: number;
  deletions?: number;
  isSelected: boolean;
  isStaged?: boolean;
  onClick: (filePath: string, staged?: boolean) => void;
  onContextMenu: (e: React.MouseEvent, filePath: string, isStaged?: boolean) => void;
  onStageToggle: (filePath: string, isStaged?: boolean) => void;
}

const FileItem = memo(function FileItem({
  path,
  status,
  additions,
  deletions,
  isSelected,
  isStaged,
  onClick,
  onContextMenu,
  onStageToggle,
}: FileItemProps) {
  const showStats = additions !== undefined || deletions !== undefined;
  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent/30 text-white"
          : "hover:bg-surface-hover dark:hover:bg-surface-hover text-text-secondary"
      }`}
      onClick={() => onClick(path, isStaged)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, path, isStaged);
      }}
    >
      {statusIcon(status)}
      <span className="truncate flex-1" title={path}>
        {formatFilePath(path)}
      </span>
      {showStats && (
        <span className="flex items-center gap-0.5 text-[10px] font-mono shrink-0">
          {(additions ?? 0) > 0 && <span className="text-status-success">+{additions}</span>}
          {(deletions ?? 0) > 0 && <span className="text-status-error">-{deletions}</span>}
        </span>
      )}
      <span className={`px-1.5 rounded text-[10px] font-medium ${statusColor(status)}`}>
        {statusLabel(status)}
      </span>
      <button
        className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover ${
          isStaged
            ? "text-semantic-notify hover:text-semantic-notify"
            : "text-status-success hover:text-status-success"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onStageToggle(path, isStaged);
        }}
        title={isStaged ? "Unstage" : "Stage"}
      >
        {isStaged ? <ChevronUp className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
      </button>
    </div>
  );
});

/* Untracked item with stage button */
interface UntrackedItemProps {
  path: string;
  isSelected: boolean;
  onClick: (filePath: string) => void;
  onContextMenu: (e: React.MouseEvent, filePath: string) => void;
  onStage: (filePath: string) => void;
}

const UntrackedItem = memo(function UntrackedItem({
  path,
  isSelected,
  onClick,
  onContextMenu,
  onStage,
}: UntrackedItemProps) {
  return (
    <div
      className={`group flex items-center gap-1.5 px-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent/30 text-white"
          : "hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary"
      }`}
      onClick={() => onClick(path)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, path);
      }}
    >
      <FileQuestion className="w-3 h-3 text-text-tertiary" />
      <span className="truncate flex-1">{path.split("/").pop()}</span>
      <span className="px-1.5 rounded text-[10px] font-medium text-text-tertiary bg-text-tertiary/10">
        U
      </span>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-status-success hover:text-status-success hover:bg-surface-hover dark:hover:bg-surface-hover"
        onClick={(e) => {
          e.stopPropagation();
          onStage(path);
        }}
        title="Stage"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
});

/* Commit file item (inside expanded commit) */
interface CommitFileItemProps {
  path: string;
  status: GitFileChange["status"];
  isSelected: boolean;
  onClick: () => void;
}

const CommitFileItem = memo(function CommitFileItem({
  path,
  status,
  isSelected,
  onClick,
}: CommitFileItemProps) {
  return (
    <div
      className={`flex items-center gap-1.5 pl-7 pr-2 py-0.5 text-xs rounded cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent/30 text-white"
          : "hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary"
      }`}
      onClick={onClick}
    >
      {statusIcon(status)}
      <span className="truncate flex-1" title={path}>
        {formatFilePath(path)}
      </span>
      <span className={`px-1.5 rounded text-[10px] font-medium ${statusColor(status)}`}>
        {statusLabel(status)}
      </span>
    </div>
  );
});

/* Expandable commit item */
interface CommitItemProps {
  commit: GitCommit;
  expanded: boolean;
  files: GitFileChange[] | undefined;
  loading: boolean;
  selectedFilePath: string | null;
  onToggle: () => void;
  onFileClick: (filePath: string) => void;
  onContextMenu: (e: React.MouseEvent, commit: GitCommit) => void;
}

const CommitItem = memo(function CommitItem({
  commit,
  expanded,
  files,
  loading,
  selectedFilePath,
  onToggle,
  onFileClick,
  onContextMenu,
}: CommitItemProps) {
  return (
    <div>
      <div
        className="flex items-start gap-1.5 px-2 py-1 text-xs hover:bg-surface-hover/50 dark:hover:bg-surface-hover/50 rounded cursor-pointer"
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, commit);
        }}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-text-tertiary mt-0.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-tertiary mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-text-secondary truncate">{commit.message}</div>
          <div className="text-text-tertiary text-[10px] flex items-center gap-1.5 mt-0.5">
            <span className="text-accent font-mono">{commit.shortHash}</span>
            <span>{commit.author}</span>
            <span>{relativeTime(commit.date)}</span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="ml-1">
          {loading ? (
            <div className="text-text-tertiary text-[10px] pl-7 py-1">Loading files...</div>
          ) : files && files.length > 0 ? (
            files.map((f) => (
              <CommitFileItem
                key={f.path}
                path={f.path}
                status={f.status}
                isSelected={selectedFilePath === f.path}
                onClick={() => onFileClick(f.path)}
              />
            ))
          ) : (
            <div className="text-text-tertiary text-[10px] pl-7 py-1">No files</div>
          )}
        </div>
      )}
    </div>
  );
});

/* ── Main Panel ─────────────────────────────────────────── */

interface GitPanelProps {
  hideOuterShell?: boolean;
}

export function GitPanel({ hideOuterShell }: GitPanelProps) {
  const isGitRepo = useGitStore((s) => s.isGitRepo);
  const branch = useGitStore((s) => s.branch);
  const ahead = useGitStore((s) => s.ahead);
  const behind = useGitStore((s) => s.behind);
  const staged = useGitStore((s) => s.staged);
  const changed = useGitStore((s) => s.changed);
  const untracked = useGitStore((s) => s.untracked);
  const commits = useGitStore((s) => s.commits);
  const loadingCommits = useGitStore((s) => s.loadingCommits);
  const currentDiff = useGitStore((s) => s.currentDiff);
  const expandedCommits = useGitStore((s) => s.expandedCommits);
  const commitFiles = useGitStore((s) => s.commitFiles);
  const loadingCommitFiles = useGitStore((s) => s.loadingCommitFiles);
  const loadingAction = useGitStore((s) => s.loadingAction);
  const worktrees = useGitStore((s) => s.worktrees);
  const fetchDiff = useGitStore((s) => s.fetchDiff);
  const fetchLog = useGitStore((s) => s.fetchLog);
  const toggleCommitExpand = useGitStore((s) => s.toggleCommitExpand);
  const fetchCommitFileDiff = useGitStore((s) => s.fetchCommitFileDiff);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const unstageFiles = useGitStore((s) => s.unstageFiles);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const refreshAll = useGitStore((s) => s.refreshAll);

  const currentPath = useExplorerStore((s) => s.currentPath);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const openFile = useExplorerStore((s) => s.openFile);

  const [commitsExpanded, setCommitsExpanded] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
    isStaged?: boolean;
  } | null>(null);
  const [commitCtxMenu, setCommitCtxMenu] = useState<{
    x: number;
    y: number;
    commit: GitCommit;
  } | null>(null);
  const copyWithFeedback = useCopyFeedback();

  const branchBtnRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    if (!currentPath) return;
    refreshAll(currentPath).then(() => {
      if (commitsExpanded && useGitStore.getState().isGitRepo) {
        fetchLog(currentPath);
      }
    });
  }, [refreshAll, fetchLog, currentPath, commitsExpanded]);

  useEffect(() => {
    refresh();
  }, [refresh, activeProjectId]);

  /* File click handlers */
  const handleFileClick = useCallback(
    (filePath: string, staged?: boolean) => {
      fetchDiff(currentPath, filePath, staged ?? false);
    },
    [fetchDiff, currentPath],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string, isStaged?: boolean) => {
      setCtxMenu({ x: e.clientX, y: e.clientY, filePath, isStaged });
    },
    [],
  );

  const handleOpenFile = useCallback(
    (filePath: string) => {
      const fullPath = `${currentPath}/${filePath}`;
      openFile({
        name: filePath.split("/").pop() ?? filePath,
        path: fullPath,
        type: "file" as const,
      });
    },
    [openFile, currentPath],
  );

  const handleCopyPath = useCallback(
    async (filePath: string) => {
      await copyWithFeedback(`${currentPath}/${filePath}`);
    },
    [copyWithFeedback, currentPath],
  );

  const getContextMenuItems = useCallback(
    (filePath: string, isStaged?: boolean): MenuItem[] => [
      {
        label: "Open Diff",
        icon: <Eye className="w-3 h-3" />,
        onClick: () => fetchDiff(currentPath, filePath, isStaged ?? false),
      },
      {
        label: "Open File",
        icon: <FileText className="w-3 h-3" />,
        onClick: () => handleOpenFile(filePath),
      },
      { label: "", onClick: () => {}, divider: true },
      {
        label: "Copy Path",
        icon: <Copy className="w-3 h-3" />,
        onClick: () => handleCopyPath(filePath),
      },
    ],
    [fetchDiff, currentPath, handleOpenFile, handleCopyPath],
  );

  /* Commit context menu */
  const handleCommitContextMenu = useCallback((e: React.MouseEvent, commit: GitCommit) => {
    setCommitCtxMenu({ x: e.clientX, y: e.clientY, commit });
  }, []);

  const getCommitContextMenuItems = useCallback(
    (commit: GitCommit): MenuItem[] => [
      {
        label: "Copy Hash",
        icon: <Copy className="w-3 h-3" />,
        onClick: () => copyWithFeedback(commit.hash),
      },
      {
        label: "Copy Message",
        icon: <Copy className="w-3 h-3" />,
        onClick: () => copyWithFeedback(commit.message),
      },
    ],
    [copyWithFeedback],
  );

  /* Commit file diff */
  const handleCommitFileClick = useCallback(
    (hash: string, filePath: string) => {
      fetchCommitFileDiff(currentPath, hash, filePath);
    },
    [fetchCommitFileDiff, currentPath],
  );

  /* Stage / Unstage */
  const handleStageToggle = useCallback(
    (filePath: string, isStaged?: boolean) => {
      if (isStaged) {
        unstageFiles(currentPath, [filePath]);
      } else {
        stageFiles(currentPath, [filePath]);
      }
    },
    [stageFiles, unstageFiles, currentPath],
  );

  const handleStageAll = useCallback(() => {
    const paths = [...changed.map((f) => f.path), ...untracked];
    if (paths.length > 0) stageFiles(currentPath, paths);
  }, [changed, untracked, stageFiles, currentPath]);

  const handleUnstageAll = useCallback(() => {
    const paths = staged.map((f) => f.path);
    if (paths.length > 0) unstageFiles(currentPath, paths);
  }, [staged, unstageFiles, currentPath]);

  const handleUntrackedStage = useCallback(
    (filePath: string) => {
      stageFiles(currentPath, [filePath]);
    },
    [stageFiles, currentPath],
  );

  /* Commits toggle */
  const toggleCommits = useCallback(() => {
    const next = !commitsExpanded;
    setCommitsExpanded(next);
    if (next && commits.length === 0) fetchLog(currentPath);
  }, [commitsExpanded, commits.length, fetchLog, currentPath]);

  /* Push / Pull */
  const handlePush = useCallback(() => push(currentPath), [push, currentPath]);
  const handlePull = useCallback(() => pull(currentPath), [pull, currentPath]);

  const totalChanges = staged.length + changed.length + untracked.length;
  const selectedFilePath = currentDiff?.filePath ?? null;

  const pinButton = <PinButton />;

  if (!isGitRepo) {
    const notGitContent = (
      <>
        <div className="px-2 py-1.5 text-xs text-text-tertiary flex items-center gap-1.5 border-b border-border-secondary">
          <GitBranch className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
          <span className="font-medium text-text-primary">Git</span>
          <span className="ml-auto">{pinButton}</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
          <div className="w-10 h-10 rounded-full bg-surface-code dark:bg-surface-dim flex items-center justify-center mb-3">
            <FileQuestion className="w-5 h-5 text-text-tertiary" />
          </div>
          <p className="text-xs text-text-tertiary font-medium mb-1">Not a Git repository</p>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Initialize a Git repository to enable version control features.
          </p>
        </div>
      </>
    );
    if (hideOuterShell) {
      return <div className="flex flex-col flex-1 overflow-hidden">{notGitContent}</div>;
    }
    return (
      <div
        data-testid="git-panel"
        className="w-60 bg-surface-dim flex flex-col flex-shrink-0 overflow-hidden"
      >
        {notGitContent}
      </div>
    );
  }

  const panelContent = (
    <>
      {/* Header: title + branch selector + actions in one row */}
      <div className="px-2 py-1.5 text-xs text-text-tertiary flex items-center gap-1.5 border-b border-border-secondary">
        <GitBranch className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
        <button
          ref={branchBtnRef}
          className="flex items-center gap-1 hover:text-text-primary dark:hover:text-white transition-colors"
          onClick={() => setShowBranches(!showBranches)}
        >
          <span className="font-medium text-text-primary">{branch}</span>
          {ahead > 0 && <span className="text-status-success">↑{ahead}</span>}
          {behind > 0 && <span className="text-semantic-notify">↓{behind}</span>}
          <BranchChevron className="w-3 h-3 text-text-tertiary" />
        </button>

        <span className="ml-auto flex items-center gap-1">
          {totalChanges > 0 && (
            <span className="bg-accent text-white px-1.5 py-0.5 rounded-full text-[10px] leading-none">
              {totalChanges}
            </span>
          )}
          {pinButton}
          <button
            onClick={handlePull}
            className="text-text-tertiary hover:text-text-primary dark:hover:text-white"
            disabled={loadingAction === "pull"}
            title="Pull"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            onClick={handlePush}
            className="text-text-tertiary hover:text-text-primary dark:hover:text-white"
            disabled={loadingAction === "push"}
            title="Push"
          >
            <Upload className="w-3 h-3" />
          </button>
          <button
            onClick={refresh}
            className="text-text-tertiary hover:text-text-primary dark:hover:text-white"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </span>
      </div>

      {/* Commit input */}
      <GitCommitInput />

      <div className="flex-1 overflow-y-auto p-1">
        {/* Staged */}
        {staged.length > 0 && (
          <div className="mt-1">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold flex items-center flex-wrap gap-x-2">
              <span>Staged Changes ({staged.length})</span>
              {formatChangeSummary(staged) && (
                <span className="text-text-tertiary font-normal normal-case tracking-normal">
                  {formatChangeSummary(staged)}
                </span>
              )}
              <button
                className="ml-auto text-semantic-notify hover:text-semantic-notify shrink-0"
                onClick={handleUnstageAll}
                title="Unstage all"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>
            {staged.map((f) => (
              <FileItem
                key={f.path}
                path={f.path}
                status={f.status}
                additions={f.additions}
                deletions={f.deletions}
                isSelected={selectedFilePath === f.path}
                isStaged
                onClick={handleFileClick}
                onContextMenu={handleContextMenu}
                onStageToggle={handleStageToggle}
              />
            ))}
          </div>
        )}

        {/* Changed */}
        {changed.length > 0 && (
          <div className="mt-2">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold flex items-center flex-wrap gap-x-2">
              <span>Changes ({changed.length})</span>
              {formatChangeSummary(changed) && (
                <span className="text-text-tertiary font-normal normal-case tracking-normal">
                  {formatChangeSummary(changed)}
                </span>
              )}
              <button
                className="ml-auto text-status-success hover:text-status-success shrink-0"
                onClick={handleStageAll}
                title="Stage all"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {changed.map((f) => (
              <FileItem
                key={f.path}
                path={f.path}
                status={f.status}
                additions={f.additions}
                deletions={f.deletions}
                isSelected={selectedFilePath === f.path}
                onClick={handleFileClick}
                onContextMenu={handleContextMenu}
                onStageToggle={handleStageToggle}
              />
            ))}
          </div>
        )}

        {/* Untracked */}
        {untracked.length > 0 && (
          <div className="mt-2">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold">
              Untracked ({untracked.length})
            </div>
            {untracked.map((f) => (
              <UntrackedItem
                key={f}
                path={f}
                isSelected={selectedFilePath === f}
                onClick={handleFileClick}
                onContextMenu={handleContextMenu}
                onStage={handleUntrackedStage}
              />
            ))}
          </div>
        )}

        {totalChanges === 0 && !commitsExpanded && (
          <div className="text-text-tertiary text-xs text-center py-8">No changes detected</div>
        )}

        {/* Commit History */}
        <div className="mt-2 border-t border-border-secondary pt-1">
          <button
            className="w-full px-2 py-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold flex items-center gap-1 hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
            onClick={toggleCommits}
          >
            {commitsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Commits
            {commits.length > 0 && (
              <span className="text-text-tertiary ml-auto">{commits.length}</span>
            )}
          </button>
          {commitsExpanded && (
            <div className="mt-0.5">
              {loadingCommits ? (
                <div className="text-text-tertiary text-xs text-center py-4">Loading...</div>
              ) : commits.length === 0 ? (
                <div className="text-text-tertiary text-xs text-center py-4">No commits</div>
              ) : (
                commits.map((c) => (
                  <CommitItem
                    key={c.hash}
                    commit={c}
                    expanded={expandedCommits.has(c.hash)}
                    files={(commitFiles[c.hash] ?? []) as GitFileChange[]}
                    loading={loadingCommitFiles.has(c.hash)}
                    selectedFilePath={selectedFilePath}
                    onToggle={() => toggleCommitExpand(currentPath, c.hash)}
                    onFileClick={(fp) => handleCommitFileClick(c.hash, fp)}
                    onContextMenu={handleCommitContextMenu}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Branch selector popup */}
      <AnchoredPopover
        anchorRef={branchBtnRef}
        open={showBranches}
        onClose={() => setShowBranches(false)}
        placement="bottom"
        align="start"
        minWidth={224}
        maxHeight={256}
      >
        <GitBranchSelector onClose={() => setShowBranches(false)} />
      </AnchoredPopover>

      {/* Worktree popup */}
      {showWorktrees && worktrees.length > 1 && (
        <div
          className="fixed z-popover min-w-[200px] bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl py-1"
          style={{ top: 80, left: 48 }}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold">
            Worktrees
          </div>
          {worktrees.map((wt) => (
            <div
              key={wt.path}
              className={`px-3 py-1.5 text-xs flex items-center gap-2 ${
                wt.path === currentPath ? "text-accent" : "text-text-secondary"
              }`}
            >
              <FolderTree className="w-3 h-3 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{wt.branch}</div>
                <div className="text-text-tertiary text-[10px] truncate">{wt.path}</div>
              </div>
              {wt.isMain && <span className="text-text-tertiary text-[10px]">main</span>}
            </div>
          ))}
          <button
            className="w-full text-left px-3 py-1 text-[10px] text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary border-t border-border-secondary mt-1 pt-1"
            onClick={() => setShowWorktrees(false)}
          >
            Close
          </button>
        </div>
      )}

      {/* Context menus */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={getContextMenuItems(ctxMenu.filePath, ctxMenu.isStaged)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {commitCtxMenu && (
        <ContextMenu
          x={commitCtxMenu.x}
          y={commitCtxMenu.y}
          items={getCommitContextMenuItems(commitCtxMenu.commit)}
          onClose={() => setCommitCtxMenu(null)}
        />
      )}
    </>
  );

  if (hideOuterShell) {
    return <div className="flex flex-col flex-1 overflow-hidden">{panelContent}</div>;
  }

  return (
    <div
      data-testid="git-panel"
      className="w-60 bg-surface-dim flex flex-col flex-shrink-0 overflow-hidden"
    >
      {panelContent}
    </div>
  );
}
