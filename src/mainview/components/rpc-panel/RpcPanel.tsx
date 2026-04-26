import { Trash2, ArrowUpRight, ArrowDownLeft, Copy, Check } from "lucide-react";
import { useState, useCallback } from "react";
import { useRpcDebugStore, type RpcLogEntry } from "../../stores/use-rpc-debug-store";
import { copyToClipboard } from "../../utils/clipboard";

const DIR_ICONS = {
  call: ArrowUpRight,
  event: ArrowDownLeft,
  response: ArrowUpRight,
};

const DIR_COLORS = {
  call: "text-blue-400",
  event: "text-green-400",
  response: "text-purple-400",
};

function RpcEntry({ entry }: { entry: RpcLogEntry }) {
  const [copied, setCopied] = useState(false);
  const Icon = DIR_ICONS[entry.direction];
  const color = DIR_COLORS[entry.direction];
  const label = entry.method || entry.eventType || entry.direction;
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fullPayload = JSON.stringify(entry.payload, null, 2);
  const truncated = JSON.stringify(entry.payload).slice(0, 200);

  const handleCopy = useCallback(() => {
    copyToClipboard(fullPayload).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }, [fullPayload]);

  return (
    <div className="group px-2 py-1 border-b border-gray-800/30 hover:bg-gray-800/30">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`w-2.5 h-2.5 shrink-0 ${color}`} />
        <span className={color}>{label}</span>
        <span className="text-gray-600 ml-auto">{time}</span>
        <button
          onClick={handleCopy}
          className="p-0.5 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          title="复制完整 payload"
        >
          {copied ? <Check className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
        </button>
      </div>
      <div className="text-gray-500 break-all leading-tight pl-3.5">
        {truncated}
      </div>
    </div>
  );
}

export function RpcPanel() {
  const entries = useRpcDebugStore((s) => s.entries);
  const clear = useRpcDebugStore((s) => s.clear);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-gray-800 shrink-0">
        <span className="text-[11px] font-medium text-gray-300">RPC 事件</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-600">{entries.length}</span>
          <button onClick={clear} className="p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-gray-300">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto text-[10px] font-mono">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600">
            暂无 RPC 事件
          </div>
        ) : (
          entries.map((entry) => <RpcEntry key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
