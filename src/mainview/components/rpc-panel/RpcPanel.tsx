import { Trash2, ArrowUpRight, ArrowDownLeft, Copy, Check, Wifi, WifiOff } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useRpcDebugStore, type RpcLogEntry } from "../../stores/use-rpc-debug-store";
import { useAppStore } from "../../stores/use-app-store";
import { useClipboard } from "../chat/preview/use-clipboard";

const DIR_ICONS = {
  call: ArrowUpRight,
  event: ArrowDownLeft,
  response: ArrowUpRight,
};

const DIR_COLORS = {
  call: "text-status-info",
  event: "text-status-success",
  response: "text-semantic-agent",
};

function stringifyPayload(payload: unknown): string {
  try {
    const value = JSON.stringify(payload, null, 2);
    return value ?? String(payload);
  } catch {
    return String(payload);
  }
}

function RpcEntry({ entry }: { entry: RpcLogEntry }) {
  const { t } = useTranslation("debug");
  const { copied, copy } = useClipboard(2000, { showToast: true });
  const Icon = DIR_ICONS[entry.direction];
  const color = DIR_COLORS[entry.direction];
  const label = entry.method ?? entry.eventType ?? entry.direction;
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const fullPayload = stringifyPayload(entry.payload);
  const truncated = fullPayload.replace(/\s+/g, " ").slice(0, 200);

  const handleCopy = useCallback(() => {
    copy(fullPayload);
  }, [fullPayload, copy]);

  return (
    <div className="group px-2 py-1 border-b border-border-secondary/30 hover:bg-surface-hover/30 dark:hover:bg-surface-dim/30">
      <div className="flex items-center gap-1 mb-0.5">
        <Icon className={`w-2.5 h-2.5 shrink-0 ${color}`} />
        <span className={color}>{label}</span>
        <span className="text-text-tertiary dark:text-text-secondary ml-auto">{time}</span>
        <button
          onClick={handleCopy}
          className="p-0.5 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          title={t("copyPayload")}
        >
          {copied ? (
            <Check className="w-2.5 h-2.5 text-status-success" />
          ) : (
            <Copy className="w-2.5 h-2.5" />
          )}
        </button>
      </div>
      <div className="text-text-tertiary break-all leading-tight pl-3.5">{truncated}</div>
    </div>
  );
}

export function RpcPanel() {
  const { t } = useTranslation("debug");
  const entries = useRpcDebugStore((s) => s.entries);
  const clear = useRpcDebugStore((s) => s.clear);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const isConnected = connectionStatus === "connected";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-secondary shrink-0">
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <Wifi className="w-3 h-3 text-status-success" />
          ) : (
            <WifiOff className="w-3 h-3 text-status-error" />
          )}
          <span className="text-[11px] font-medium text-text-secondary">{t("rpcEvents")}</span>
          <span
            className={`text-[9px] ${isConnected ? "text-status-success" : "text-status-error"}`}
          >
            {isConnected ? t("connected") : t("disconnected")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-text-tertiary dark:text-text-secondary">
            {entries.length}
          </span>
          <button
            onClick={clear}
            className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto text-[10px] font-mono">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary dark:text-text-secondary">
            {t("noRpcEvents")}
          </div>
        ) : (
          entries.map((entry) => <RpcEntry key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
