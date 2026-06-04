import { useState, useCallback } from "react";
import { Check } from "lucide-react";
import { useGitStore } from "../../stores/use-git-store";
import { useExplorerStore } from "../../stores/use-explorer-store";

/**
 * Git commit message input — VS Code style.
 * Shows at the top of the Git panel when there are staged changes.
 * Self-contained: only depends on useGitStore + useExplorerStore.
 */
export function GitCommitInput() {
  const staged = useGitStore((s) => s.staged);
  const loadingAction = useGitStore((s) => s.loadingAction);
  const commit = useGitStore((s) => s.commit);
  const currentPath = useExplorerStore((s) => s.currentPath);

  const [message, setMessage] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed || staged.length === 0) return;
    commit(currentPath, trimmed);
    setMessage("");
  }, [message, staged.length, commit, currentPath]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (staged.length === 0) return null;

  const isCommitting = loadingAction === "commit";

  return (
    <div className="p-2 border-b border-border-secondary">
      <textarea
        className="w-full bg-surface-dim border border-border-secondary rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary resize-none outline-none focus:border-semantic-accent transition-colors"
        rows={3}
        placeholder="Commit message (Ctrl+Enter to commit)"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isCommitting}
      />
      <button
        className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-semantic-accent hover:bg-semantic-accent/80 text-white"
        onClick={handleSubmit}
        disabled={!message.trim() || isCommitting}
      >
        <Check className="w-3 h-3" />
        {isCommitting ? "Committing..." : "Commit"}
      </button>
    </div>
  );
}
