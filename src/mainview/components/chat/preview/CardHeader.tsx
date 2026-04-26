import { memo } from "react";
import { ExternalLink, Copy, Check, RefreshCw, Maximize2 } from "lucide-react";
import { useClipboard } from "./use-clipboard";
import { getFileHttpUrl } from "./types";

interface CardActionBarProps {
  absolutePath?: string;
  onRetry?: () => void;
  onExpand?: () => void;
}

export const CardActionBar = memo(function CardActionBar({
  absolutePath,
  onRetry,
  onExpand,
}: CardActionBarProps) {
  const { copied, copy } = useClipboard();

  if (!absolutePath) return null;

  const url = getFileHttpUrl(absolutePath);

  return (
    <div className="flex items-center gap-1 ml-auto shrink-0">
      {onRetry && (
        <button
          onClick={onRetry}
          className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
          title="重新加载"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
      {onExpand && (
        <button
          onClick={onExpand}
          className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
          title="全屏展开"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => copy(url)}
        className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
        title="复制链接"
      >
        {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      </button>
      <button
        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
        className="p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
        title="在新窗口打开"
      >
        <ExternalLink className="w-3 h-3" />
      </button>
    </div>
  );
});

interface CardHeaderProps {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  absolutePath?: string;
  onRetry?: () => void;
  onExpand?: () => void;
}

export const CardHeader = memo(function CardHeader({
  icon,
  label,
  meta,
  absolutePath,
  onRetry,
  onExpand,
}: CardHeaderProps) {
  return (
    <div className="px-3 py-1.5 flex items-center gap-2 text-xs border-b border-gray-700/30">
      {icon}
      <span className="text-gray-300 truncate min-w-0">{label}</span>
      {meta && <span className="text-gray-500 shrink-0 text-[10px]">{meta}</span>}
      <CardActionBar absolutePath={absolutePath} onRetry={onRetry} onExpand={onExpand} />
    </div>
  );
});
