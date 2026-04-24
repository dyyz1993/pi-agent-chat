import { Copy, RefreshCw, Trash2 } from "lucide-react";

interface ActionButtonsProps {
  onCopy?: () => void;
  onRetry?: () => void;
  onDelete?: () => void;
}

export function ActionButtons({ onCopy, onRetry, onDelete }: ActionButtonsProps) {
  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      {onCopy && (
        <button onClick={onCopy} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title="复制">
          <Copy className="w-3 h-3" />
        </button>
      )}
      {onRetry && (
        <button onClick={onRetry} className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300" title="重试">
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} className="p-1 rounded hover:bg-gray-700 text-red-500/60 hover:text-red-400" title="删除">
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
