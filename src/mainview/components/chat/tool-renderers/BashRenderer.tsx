import { memo, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, X } from "lucide-react";
import type { ContentBlock } from "../../../types";
import { useSessionStore } from "../../../stores/use-session-store";
import { apiClient } from "../../../lib/api-client";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

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

export const BashExecutionCard = memo(function BashExecutionCard({ block }: { block: Block }) {
	const isRunning = block.status === "running";
	const isError = block.status === "error";
	const [elapsed, setElapsed] = useState(0);
	const startedAt = useRef(Date.now());

	const bashDetails = block.details as BashDetails | undefined;
	const isBackground = !!bashDetails?.background;
	const isTerminated = !!bashDetails?.terminated;

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
		borderBg = "border-yellow-500/30 bg-yellow-950/10";
		statusLabel = <span className="text-yellow-400 text-[10px]">已后台运行</span>;
	} else if (isTerminated) {
		borderBg = "border-red-500/20 bg-red-950/10";
		statusLabel = <span className="text-red-400 text-[10px]">已取消</span>;
	} else if (isRunning) {
		borderBg = "border-blue-500/30 bg-blue-950/15";
	} else if (isError) {
		borderBg = "border-red-500/20 bg-red-950/10";
	} else {
		borderBg = "border-gray-700/40 bg-gray-800/20";
	}

	return (
		<div className={`my-1.5 -mx-3 rounded-none overflow-hidden border-x-0 border-t border-b ${borderBg}`}>
			<div className="px-3 py-1.5 flex items-center gap-2 text-xs">
				<span className={`font-medium ${isBackground ? "text-yellow-400" : isTerminated ? "text-red-400" : isRunning ? "text-blue-400" : isError ? "text-red-400" : "text-gray-300"}`}>{block.toolName}</span>
				{isRunning && !statusLabel && <span className="text-blue-400 animate-pulse text-[10px]">running</span>}
				{statusLabel}
				{bashDetails?.background && <span className="text-[10px] text-gray-500">PID: {bashDetails.background.pid}</span>}
				{bashDetails?.background && <span className="text-[10px] text-gray-500">{formatDuration(bashDetails.background.durationMs)}</span>}
				{bashDetails?.terminated && <span className="text-[10px] text-gray-500">{formatDuration(bashDetails.terminated.durationMs)}</span>}
			</div>

			<details className="group">
				<summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
					<svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
					<span>Input</span>
				</summary>
				<div className="px-3 pb-2">
					{block.args ? (
						<pre className="text-[11px] text-yellow-300/60 overflow-x-auto whitespace-pre-wrap font-mono max-h-40 overflow-y-auto leading-relaxed">{block.args}</pre>
					) : null}
				</div>
			</details>

			<details open className="group">
				<summary className="px-3 py-1 text-[11px] text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1.5 border-t border-gray-700/30">
					<svg className="w-3 h-3 transition-transform group-open:rotate-90 shrink-0" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
					<span>Output</span>
					{isRunning && <span className="ml-auto text-blue-400/70 animate-pulse text-[10px]">streaming</span>}
				</summary>
				<div className="px-3 pb-2">
					{block.output ? (
						<pre className="text-[11px] text-gray-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">{block.output}</pre>
					) : isRunning ? (
						<div className="text-[11px] text-gray-600 italic py-1">waiting...</div>
					) : null}
				</div>
			</details>

			{isRunning && (
				<div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-gray-700/30">
					{showBackground && (
						<button
							onClick={() => sendAction("background")}
							className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-yellow-600/40 text-[10px] text-yellow-400 hover:bg-yellow-600/15 transition-colors"
							title="转为后台运行"
						>
							<ArrowDownToLine className="w-3 h-3" />
							<span>后台运行</span>
						</button>
					)}
					{!showBackground && <div className="flex-1" />}
					<button
						onClick={() => sendAction("kill")}
						className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-red-600/30 text-[10px] text-red-400 hover:bg-red-600/10 transition-colors"
						title="取消执行"
					>
						<X className="w-3 h-3" />
						<span>取消</span>
					</button>
				</div>
			)}
		</div>
	);
});
