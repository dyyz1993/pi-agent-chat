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
import { copyToClipboard } from "../../utils/clipboard";
import { useSessionStore } from "../../stores/use-session-store";
import { ContextMenu, type MenuItem } from "../explorer/ContextMenu";
import { GitCommitInput } from "./GitCommitInput";
import { GitBranchSelector } from "./GitBranchSelector";
import { PinButton } from "../sidebar/PinButton";

/* ── Helpers ────────────────────────────────────────────── */

function statusIcon(status: GitFileChange["status"]) {
  switch (status) {
    case "added":
      return <Plus className="w-3 h-3 text-green-400" />;
    case "deleted":
      return <Minus className="w-3 h-3 text-red-400" />;
    case "modified":
      return <Pencil className="w-3 h-3 text-yellow-400" />;
    default:
      return <FileQuestion className="w-3 h-3 text-gray-400" />;
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
      return "text-green-400 bg-green-400/10";
    case "deleted":
      return "text-red-400 bg-red-400/10";
    case "modified":
      return "text-yellow-400 bg-yellow-400/10";
    case "renamed":
      return "text-blue-400 bg-blue-400/10";
    case "copied":
      return "text-cyan-400 bg-cyan-400/10";
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
          ? "bg-indigo-600/30 text-white"
          : "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
      }`}
      onClick={() => onClick(path, isStaged)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, path, isStaged);
      }}
    >
      {statusIcon(status)}
      <span className="truncate flex-1">{path.split("/").pop()}</span>
      {showStats && (
        <span className="flex items-center gap-0.5 text-[10px] font-mono shrink-0">
          {(additions ?? 0) > 0 && <span className="text-green-400">+{additions}</span>}
          {(deletions ?? 0) > 0 && <span className="text-red-400">-{deletions}</span>}
        </span>
      )}
      <span className={`px-1.5 rounded text-[10px] font-medium ${statusColor(status)}`}>
        {statusLabel(status)}
      </span>
      <button
        className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-300 dark:hover:bg-gray-600 ${
          isStaged ? "text-orange-400 hover:text-orange-300" : "text-green-400 hover:text-green-300"
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
          ? "bg-indigo-600/30 text-white"
          : "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
      }`}
      onClick={() => onClick(path)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, path);
      }}
    >
      <FileQuestion className="w-3 h-3 text-gray-500" />
      <span className="truncate flex-1">{path.split("/").pop()}</span>
      <span className="px-1.5 rounded text-[10px] font-medium text-gray-400 bg-gray-400/10">U</span>
      <button
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-green-400 hover:text-green-300 hover:bg-gray-300 dark:hover:bg-gray-600"
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
          ? "bg-indigo-600/30 text-white"
          : "hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
      }`}
      onClick={onClick}
    >
      {statusIcon(status)}
      <span className="truncate flex-1">{path.split("/").pop()}</span>
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
        className="flex items-start gap-1.5 px-2 py-1 text-xs hover:bg-gray-200/50 dark:hover:bg-gray-700/50 rounded cursor-pointer"
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, commit);
        }}
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-gray-500 mt-0.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-500 mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-gray-700 dark:text-gray-300 truncate">{commit.message}</div>
          <div className="text-gray-500 text-[10px] flex items-center gap-1.5 mt-0.5">
            <span className="text-indigo-400 font-mono">{commit.shortHash}</span>
            <span>{commit.author}</span>
            <span>{relativeTime(commit.date)}</span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="ml-1">
          {loading ? (
            <div className="text-gray-400 dark:text-gray-600 text-[10px] pl-7 py-1">
              Loading files...
            </div>
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
            <div className="text-gray-400 dark:text-gray-600 text-[10px] pl-7 py-1">No files</div>
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
  const fetchStatus = useGitStore((s) => s.fetchStatus);
  const fetchDiff = useGitStore((s) => s.fetchDiff);
  const fetchLog = useGitStore((s) => s.fetchLog);
  const toggleCommitExpand = useGitStore((s) => s.toggleCommitExpand);
  const fetchCommitFileDiff = useGitStore((s) => s.fetchCommitFileDiff);
  const stageFiles = useGitStore((s) => s.stageFiles);
  const unstageFiles = useGitStore((s) => s.unstageFiles);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetchWorktrees = useGitStore((s) => s.fetchWorktrees);
  const fetchBranches = useGitStore((s) => s.fetchBranches);

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

  const branchBtnRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    if (!currentPath) return;
    fetchStatus(currentPath);
    fetchWorktrees(currentPath);
    fetchBranches(currentPath);
    if (commitsExpanded) fetchLog(currentPath);
  }, [fetchStatus, fetchWorktrees, fetchBranches, fetchLog, currentPath, commitsExpanded]);

  useEffect(() => {
    refresh();
  }, [refresh, activeProjectId]);

  /* File click handlers */
  const handleFileClick = useCallback(
    (filePath: string, staged?: boolean) => {
      fetchDiff(currentPath, filePath, staged);
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
      await copyToClipboard(`${currentPath}/${filePath}`);
    },
    [currentPath],
  );

  const getContextMenuItems = useCallback(
    (filePath: string, isStaged?: boolean): MenuItem[] => [
      {
        label: "Open Diff",
        icon: <Eye className="w-3 h-3" />,
        onClick: () => fetchDiff(currentPath, filePath, isStaged),
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
        onClick: () => copyToClipboard(commit.hash),
      },
      {
        label: "Copy Message",
        icon: <Copy className="w-3 h-3" />,
        onClick: () => copyToClipboard(commit.message),
      },
    ],
    [],
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

  const panelContent = (
    <>
      {/* Header: title + branch selector + actions in one row */}
      <div className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5 border-b border-gray-200 dark:border-gray-700">
        <GitBranch className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
        <button
          ref={branchBtnRef}
          className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => setShowBranches(!showBranches)}
        >
          <span className="font-medium text-gray-900 dark:text-white">{branch}</span>
          {ahead > 0 && <span className="text-green-400">↑{ahead}</span>}
          {behind > 0 && <span className="text-orange-400">↓{behind}</span>}
          <BranchChevron className="w-3 h-3 text-gray-400 dark:text-gray-500" />
        </button>

        <span className="ml-auto flex items-center gap-1">
          {totalChanges > 0 && (
            <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded-full text-[10px] leading-none">
              {totalChanges}
            </span>
          )}
          {pinButton}
          <button
            onClick={handlePull}
            className="text-gray-500 hover:text-gray-800 dark:hover:text-white"
            disabled={loadingAction === "pull"}
            title="Pull"
          >
            <Download className="w-3 h-3" />
          </button>
          <button
            onClick={handlePush}
            className="text-gray-500 hover:text-gray-800 dark:hover:text-white"
            disabled={loadingAction === "push"}
            title="Push"
          >
            <Upload className="w-3 h-3" />
          </button>
          <button
            onClick={refresh}
            className="text-gray-500 hover:text-gray-800 dark:hover:text-white"
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
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center flex-wrap gap-x-2">
              <span>Staged Changes ({staged.length})</span>
              {formatChangeSummary(staged) && (
                <span className="text-gray-400 dark:text-gray-600 font-normal normal-case tracking-normal">
                  {formatChangeSummary(staged)}
                </span>
              )}
              <button
                className="ml-auto text-orange-400 hover:text-orange-300 shrink-0"
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
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center flex-wrap gap-x-2">
              <span>Changes ({changed.length})</span>
              {formatChangeSummary(changed) && (
                <span className="text-gray-400 dark:text-gray-600 font-normal normal-case tracking-normal">
                  {formatChangeSummary(changed)}
                </span>
              )}
              <button
                className="ml-auto text-green-400 hover:text-green-300 shrink-0"
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
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
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
          <div className="text-gray-500 dark:text-gray-500 text-xs text-center py-8">
            No changes detected
          </div>
        )}

        {/* Commit History */}
        <div className="mt-2 border-t border-gray-200 dark:border-gray-700 pt-1">
          <button
            className="w-full px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            onClick={toggleCommits}
          >
            {commitsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Commits
            {commits.length > 0 && (
              <span className="text-gray-400 dark:text-gray-600 ml-auto">{commits.length}</span>
            )}
          </button>
          {commitsExpanded && (
            <div className="mt-0.5">
              {loadingCommits ? (
                <div className="text-gray-500 text-xs text-center py-4">Loading...</div>
              ) : commits.length === 0 ? (
                <div className="text-gray-400 dark:text-gray-600 text-xs text-center py-4">
                  No commits
                </div>
              ) : (
                commits.map((c) => (
                  <CommitItem
                    key={c.hash}
                    commit={c}
                    expanded={expandedCommits.has(c.hash)}
                    files={commitFiles[c.hash]}
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
      {showBranches && branchBtnRef.current && (
        <div
          className="absolute z-50"
          style={{
            top: branchBtnRef.current.getBoundingClientRect().bottom + 4,
            left: branchBtnRef.current.getBoundingClientRect().left,
          }}
        >
          <GitBranchSelector onClose={() => setShowBranches(false)} />
        </div>
      )}

      {/* Worktree popup */}
      {showWorktrees && worktrees.length > 1 && (
        <div
          className="fixed z-50 min-w-[200px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-xl py-1"
          style={{ top: 80, left: 48 }}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
            Worktrees
          </div>
          {worktrees.map((wt) => (
            <div
              key={wt.path}
              className={`px-3 py-1.5 text-xs flex items-center gap-2 ${
                wt.path === currentPath ? "text-indigo-400" : "text-gray-700 dark:text-gray-300"
              }`}
            >
              <FolderTree className="w-3 h-3 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{wt.branch}</div>
                <div className="text-gray-500 text-[10px] truncate">{wt.path}</div>
              </div>
              {wt.isMain && (
                <span className="text-gray-400 dark:text-gray-600 text-[10px]">main</span>
              )}
            </div>
          ))}
          <button
            className="w-full text-left px-3 py-1 text-[10px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-t border-gray-200 dark:border-gray-700 mt-1 pt-1"
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
      className="w-60 bg-gray-50 dark:bg-gray-850 flex flex-col flex-shrink-0 overflow-hidden"
    >
      {panelContent}
    </div>
  );
}
