import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownToLine, X, Eye } from "lucide-react";
import type { ContentBlock } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { useBashStore } from "../../../stores/use-bash-store";
import { tryFormatAsYaml } from "../../../../shared/lib/json-to-yaml";
import { apiClient } from "../../../lib/api-client";
import { AnsiText } from "../primitives/AnsiText";
import { LogViewer } from "../../bash-panel/BashPanel";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;
const EMPTY_PROCS: never[] = [];

interface BashDetails {
  background?: {
    pid: number;
    command: string;
    startedAt: number;
    durationMs: number;
    output?: string;
    detached: boolean;
  };
  terminated?: {
    pid?: number;
    command: string;
    startedAt: number;
    endedAt: number;
    durationMs: number;
    output?: string;
  };
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

export const BashExecutionCard = memo(function BashExecutionCard({
  block,
  blockId,
}: {
  block: Block;
  blockId?: string;
}) {
  const sid = useSessionStore((s) => s.activeSessionId);
  const bashProcess = useBashStore((s) => {
    const procs = s.processesBySession[sid ?? ""] || EMPTY_PROCS;
    return procs.find((p) => p.toolCallId === block.toolCallId);
  });
  const blockIsRunning = block.status === "running";
  const blockIsError = block.status === "error";
  const [elapsed, setElapsed] = useState(0);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [outputOpen, setOutputOpen] = useState(true);
  const startedAt = useRef(Date.now());

  const bashDetails = block.details as BashDetails | undefined;
  const storeStatus = bashProcess?.status;
  const isBackground = !!bashDetails?.background || storeStatus === "background";
  const isTerminated = !!bashDetails?.terminated || storeStatus === "terminated";
  const isRunning = blockIsRunning && !isBackground && !isTerminated;
  const isError = blockIsError;

  useEffect(() => {
    if (isBackground) {
      setOutputOpen(false);
    }
  }, [isBackground]);

  useEffect(() => {
    if (!isRunning) return;
    startedAt.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const showBackground = elapsed > 5000 && isRunning;

  async function sendAction(action: "kill" | "background") {
    const sid = useSessionStore.getState().activeSessionId;
    if (!sid) return;
    await apiClient.call("bash.command", { sessionId: sid, action, toolCallId: block.toolCallId });
  }

  let borderBg: string;
  let statusLabel: React.ReactNode = null;

  if (isBackground) {
    borderBg = "border-yellow-500/30 bg-yellow-50 dark:bg-yellow-950/10";
    statusLabel = (
      <span className="text-yellow-600 dark:text-yellow-400 text-[10px]">已后台运行</span>
    );
  } else if (isTerminated) {
    borderBg = "border-red-500/20 bg-red-50 dark:bg-red-950/10";
    statusLabel = <span className="text-red-500 dark:text-red-400 text-[10px]">已取消</span>;
  } else if (isRunning) {
    borderBg = "border-blue-500/30 bg-blue-50 dark:bg-blue-950/15";
  } else if (isError) {
    borderBg = "border-red-500/20 bg-red-50 dark:bg-red-950/10";
  } else {
    borderBg = "border-gray-200 dark:border-gray-700/40 bg-gray-50 dark:bg-gray-800/20";
  }

  return (
    <div
      data-block-id={blockId}
      className={`rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}
    >
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <span
          className={`font-medium ${isBackground ? "text-yellow-600 dark:text-yellow-400" : isTerminated ? "text-red-500 dark:text-red-400" : isRunning ? "text-blue-500 dark:text-blue-400" : isError ? "text-red-500 dark:text-red-400" : "text-gray-800 dark:text-gray-300"}`}
        >
          {block.toolName}
        </span>
        {isRunning && !statusLabel && (
          <span className="text-blue-500 dark:text-blue-400 animate-pulse text-[10px]">
            running
          </span>
        )}
        {statusLabel}
        {bashDetails?.background && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            PID: {bashDetails.background.pid}
          </span>
        )}
        {(bashDetails?.background ?? (storeStatus === "background" && bashProcess)) && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {formatDuration(
              bashDetails?.background?.durationMs ??
                Date.now() - (bashProcess?.startedAt ?? Date.now()),
            )}
          </span>
        )}
        {(bashDetails?.terminated ?? (storeStatus === "terminated" && bashProcess)) && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {formatDuration(
              bashDetails?.terminated?.durationMs ??
                (bashProcess?.endedAt ?? Date.now()) - (bashProcess?.startedAt ?? Date.now()),
            )}
          </span>
        )}
      </div>

      <details className="group">
        <summary className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-200 dark:border-gray-700/30">
          <svg
            className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4.5 3l3 3-3 3" />
          </svg>
          <span>Input</span>
        </summary>
        <div className="px-3 pb-2">
          {block.args ? (
            <pre className="text-[11px] text-yellow-600/70 dark:text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">
              {tryFormatAsYaml(block.args)}
            </pre>
          ) : null}
        </div>
      </details>

      <details
        open={outputOpen}
        onToggle={(e) => setOutputOpen(e.currentTarget.open)}
        className="group"
      >
        <summary className="px-3 py-1 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-200 dark:border-gray-700/30">
          <svg
            className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4.5 3l3 3-3 3" />
          </svg>
          <span>Output</span>
          {isRunning && (
            <span className="ml-auto text-blue-500/70 dark:text-blue-400/70 animate-pulse text-[10px]">
              streaming
            </span>
          )}
        </summary>
        <div className="px-3 pb-2">
          {block.output ? (
            <AnsiText
              content={block.output}
              className="text-[11px] overflow-x-auto leading-relaxed max-h-72 overflow-y-auto"
            />
          ) : isRunning ? (
            <div className="text-[11px] text-gray-400 dark:text-gray-600 italic py-1">
              waiting...
            </div>
          ) : null}
        </div>
      </details>

      {isRunning && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700/30">
          {showBackground && (
            <button
              onClick={() => sendAction("background")}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-yellow-500/40 dark:border-yellow-600/40 text-[10px] text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-600/15 transition-colors"
              title="转为后台运行"
            >
              <ArrowDownToLine className="w-3 h-3" />
              <span>后台运行</span>
            </button>
          )}
          {!showBackground && <div className="flex-1" />}
          <button
            onClick={() => sendAction("kill")}
            className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-red-500/30 dark:border-red-600/30 text-[10px] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-600/10 transition-colors"
            title="取消执行"
          >
            <X className="w-3 h-3" />
            <span>取消</span>
          </button>
        </div>
      )}

      {isBackground && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700/30">
          <div className="flex-1" />
          <button
            onClick={() => setShowLogViewer(true)}
            className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-cyan-500/40 dark:border-cyan-600/40 text-[10px] text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-cyan-600/15 transition-colors"
            title="查看输出"
          >
            <Eye className="w-3 h-3" />
            <span>查看输出</span>
          </button>
        </div>
      )}

      {showLogViewer &&
        bashProcess?.logPath &&
        createPortal(
          <LogViewer
            logPath={bashProcess.logPath}
            toolCallId={block.toolCallId}
            onClose={() => setShowLogViewer(false)}
          />,
          document.body,
        )}
    </div>
  );
});
