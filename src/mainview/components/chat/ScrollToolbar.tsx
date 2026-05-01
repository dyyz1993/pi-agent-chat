import { memo } from "react";
import {
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
} from "lucide-react";

interface ScrollToolbarProps {
  isAtTop: boolean;
  isAtBottom: boolean;
  autoScrollEnabled: boolean;
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
  onToggleAutoScroll: () => void;
}

export const ScrollToolbar = memo(function ScrollToolbar({
  isAtTop,
  isAtBottom,
  autoScrollEnabled,
  onScrollToTop,
  onScrollToBottom,
  onToggleAutoScroll,
}: ScrollToolbarProps) {
  const showNavButtons = !isAtTop || !isAtBottom;

  return (
    <div className="absolute bottom-3 right-2.5 flex flex-col gap-1.5 z-10">
      <button
        onClick={onToggleAutoScroll}
        className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
          autoScrollEnabled
            ? "border-indigo-400/40 text-indigo-400 hover:text-indigo-300 hover:border-indigo-300/50"
            : "border-gray-500/30 text-gray-500 hover:text-gray-300 hover:border-gray-400/40"
        }`}
        title={autoScrollEnabled ? "停止自动滚动" : "开启自动滚动"}
      >
        {autoScrollEnabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      {showNavButtons && (
        <div className="flex flex-col gap-1">
          {!isAtTop && (
            <button
              onClick={onScrollToTop}
              className="w-9 h-9 rounded-full border border-gray-500/30 text-gray-500 hover:text-indigo-300 hover:border-indigo-400/40 flex items-center justify-center transition-colors"
              title="回到顶部"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          {!isAtBottom && (
            <button
              onClick={onScrollToBottom}
              className="w-9 h-9 rounded-full border border-gray-500/30 text-gray-500 hover:text-indigo-300 hover:border-indigo-400/40 flex items-center justify-center transition-colors"
              title="回到底部"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
