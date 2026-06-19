import { memo } from "react";
import { ExternalLink } from "lucide-react";

interface SessionJumpButtonProps {
  onJump: () => void;
  title?: string;
}

export const SessionJumpButton = memo(function SessionJumpButton({
  onJump,
  title = "跳转到对应会话",
}: SessionJumpButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-500/10 transition-colors"
      title={title}
      aria-label={title}
    >
      <ExternalLink className="w-3 h-3" />
    </button>
  );
});
