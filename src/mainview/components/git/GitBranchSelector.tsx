import { useEffect, useCallback } from "react";
import { GitBranch as BranchIcon, Check } from "lucide-react";
import { useGitStore, type GitBranch } from "../../stores/use-git-store";
import { useExplorerStore } from "../../stores/use-explorer-store";

/**
 * Branch selector popup — lists local/remote branches with checkout action.
 * Self-contained: only depends on useGitStore + useExplorerStore.
 */
interface GitBranchSelectorProps {
  onClose: () => void;
}

export function GitBranchSelector({ onClose }: GitBranchSelectorProps) {
  const branches = useGitStore((s) => s.branches);
  const loadingBranches = useGitStore((s) => s.loadingBranches);
  const loadingAction = useGitStore((s) => s.loadingAction);
  const fetchBranches = useGitStore((s) => s.fetchBranches);
  const checkout = useGitStore((s) => s.checkout);
  const currentPath = useExplorerStore((s) => s.currentPath);

  useEffect(() => {
    fetchBranches(currentPath);
  }, [fetchBranches, currentPath]);

  const handleCheckout = useCallback(
    (branch: GitBranch) => {
      if (branch.isCurrent) return;
      const name = branch.isRemote ? branch.name.split("/").slice(1).join("/") : branch.name;
      if (!name) return;
      checkout(currentPath, name);
      onClose();
    },
    [checkout, currentPath, onClose],
  );

  const localBranches = branches.filter((b) => !b.isRemote);
  const remoteBranches = branches.filter((b) => b.isRemote);

  const renderBranch = (b: GitBranch) => (
    <button
      key={b.name}
      className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
        b.isCurrent
          ? "text-accent"
          : "text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
      }`}
      onClick={() => handleCheckout(b)}
      disabled={loadingAction === "checkout"}
    >
      {b.isCurrent && <Check className="w-3 h-3 shrink-0" />}
      {!b.isCurrent && <span className="w-3 shrink-0" />}
      <BranchIcon className="w-3 h-3 shrink-0" />
      <span className="truncate">{b.isRemote ? b.name.split("/").slice(1).join("/") : b.name}</span>
    </button>
  );

  return (
    <div
      className="max-h-full overflow-y-auto bg-bg-elevated dark:bg-surface-dim border border-border-secondary rounded-md shadow-xl py-1"
      role="menu"
    >
      {loadingBranches ? (
        <div className="text-text-tertiary text-xs text-center py-4">Loading branches...</div>
      ) : (
        <>
          {localBranches.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold">
                Local
              </div>
              {localBranches.map(renderBranch)}
            </>
          )}
          {remoteBranches.length > 0 && (
            <>
              <div className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold border-t border-border-secondary pt-1">
                Remote
              </div>
              {remoteBranches.map(renderBranch)}
            </>
          )}
        </>
      )}
    </div>
  );
}
