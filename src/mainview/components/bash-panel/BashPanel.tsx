import { useState, useEffect } from "react";
import {
	ChevronDown,
	ChevronRight,
	Terminal,
	ArrowDownToLine,
	X,
	Trash2,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../../stores/use-session-store";
import { useBashStore } from "../../stores/use-bash-store";
import type { BashProcess } from "../../../shared/modules/bash";
import { apiClient } from "../../lib/api-client";

function formatOutputSize(output: string): string {
	const bytes = new TextEncoder().encode(output).length;
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function BashProcessCard({ process: p }: { process: BashProcess }) {
	const [elapsed, setElapsed] = useState(Date.now() - p.startedAt);
	const showBackground = elapsed > 5000 && p.status === "running";

	useEffect(() => {
		if (p.status !== "running") return;
		const start = Date.now() - p.startedAt;
		setElapsed(start);
		const id = setInterval(() => setElapsed(Date.now() - p.startedAt), 1000);
		return () => clearInterval(id);
	}, [p.status, p.startedAt]);

	async function sendAction(action: "kill" | "background") {
		const sid = useSessionStore.getState().activeSessionId;
		if (!sid) return;
		await apiClient.call("bash.command", {
			sessionId: sid,
			action,
			toolCallId: p.toolCallId,
		});
	}

	function formatDuration(ms: number): string {
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		return `${m}m${s % 60}s`;
	}

	const isBackground = p.status === "background";

	return (
		<div className="rounded-lg bg-gray-900/80 border border-gray-800 p-3 space-y-2">
			<div className="flex items-start gap-2">
				<span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
					isBackground
						? "bg-yellow-400"
						: p.status === "error"
							? "bg-red-400"
							: "bg-blue-400 animate-pulse"
				}`} />
				<div className="flex-1 min-w-0">
					<div className="text-[11px] font-medium text-gray-200 truncate font-mono" title={p.command}>
						{p.command}
					</div>
					<div className="flex items-center gap-3 mt-1 text-[9px] text-gray-500">
						<span className={isBackground ? "text-yellow-400/80" : ""}>
							{isBackground ? "后台运行" : "执行中"}
						</span>
						{p.output && <span>输出: {formatOutputSize(p.output)}</span>}
						{p.pid && <span>PID: {p.pid}</span>}
						<span>{formatDuration(elapsed)}</span>
					</div>
				</div>
			</div>

			<div className="flex items-center gap-1.5 pt-1">
				{showBackground && !isBackground && (
					<button
						onClick={() => sendAction("background")}
						className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-yellow-600/40 text-[10px] text-yellow-400 hover:bg-yellow-600/15 transition-colors"
						title="转为后台运行（agent 继续执行，进程保持）"
					>
						<ArrowDownToLine className="w-3 h-3" />
						<span>后台运行</span>
					</button>
				)}

				{(!showBackground || isBackground) && <div className="flex-1" />}

				{p.status === "running" && (
					<button
						onClick={() => sendAction("kill")}
						className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-red-600/30 text-[10px] text-red-400 hover:bg-red-600/10 transition-colors shrink-0"
						title="取消执行"
					>
						<X className="w-3 h-3" />
						<span>取消</span>
					</button>
				)}

				{isBackground && (
					<button
						onClick={() => sendAction("kill")}
						className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-red-600/30 text-[10px] text-red-400 hover:bg-red-600/10 transition-colors w-16 shrink-0"
						title="终止进程"
					>
						<X className="w-3 h-3" />
					</button>
				)}

				<button
					onClick={() => useBashStore.getState().removeProcess(
						useSessionStore.getState().activeSessionId ?? "",
						p.toolCallId,
					)}
					className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-gray-700/50 text-[10px] text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors w-12 shrink-0"
					title="从列表移除"
				>
					<Trash2 className="w-3 h-3" />
				</button>
			</div>

			{p.error && (
				<pre className="text-[9px] text-red-400/70 font-mono max-h-12 overflow-hidden whitespace-pre-wrap break-all mt-1 rounded bg-red-900/20 px-1.5 py-1">
					{p.error.slice(-300)}
				</pre>
			)}
		</div>
	);
}

export function BashPanel() {
	const activeSessionId = useSessionStore((s) => s.activeSessionId);
	const allProcesses = useBashStore(useShallow((s) => s.processesBySession[activeSessionId ?? ""]));
	const [collapsed, setCollapsed] = useState(false);

	const activeProcesses = allProcesses?.filter((p) =>
		p.status === "running" || p.status === "background",
	) ?? [];

	if (activeProcesses.length === 0) {
		return null;
	}

	return (
		<div className="px-3 py-2 space-y-2">
			<button
				onClick={() => setCollapsed(!collapsed)}
				className="w-full flex items-center gap-1.5 text-[11px] font-medium text-gray-300 hover:text-white transition-colors"
			>
				{collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
				<Terminal className="w-3 h-3" />
				<span>SHELL</span>
				<span className="ml-auto text-[9px] text-gray-600">{activeProcesses.length}</span>
			</button>

			{!collapsed && (
				<div className="space-y-2 pl-1">
					{activeProcesses.map((p) => (
						<BashProcessCard key={p.toolCallId} process={p} />
					))}
				</div>
			)}
		</div>
	);
}
