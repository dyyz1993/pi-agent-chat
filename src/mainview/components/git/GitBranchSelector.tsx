import { useEffect, useCallback, useRef } from "react";
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchBranches(currentPath);
  }, [fetchBranches, currentPath]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

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
          ? "text-semantic-accent"
          : "text-text-primary dark:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
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
      ref={ref}
      className="fixed z-50 w-56 max-h-64 overflow-y-auto bg-bg-elevated dark:bg-surface-dim border border-border-secondary dark:border-border-secondary rounded-md shadow-xl py-1"
      style={
        {
          /* positioned by parent via absolute */
        }
      }
    >
      {loadingBranches ? (
        <div className="text-text-tertiary dark:text-text-tertiary text-xs text-center py-4">
          Loading branches...
        </div>
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
              <div className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide text-text-tertiary font-semibold border-t border-border-secondary dark:border-border-secondary pt-1">
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
