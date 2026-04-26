import { useState, useEffect } from "react";
import {
	ChevronDown,
	ChevronRight,
	Terminal,
	ArrowDownToLine,
	X,
	Trash2,
	Eye,
	EyeOff,
	FileText,
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

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

function BashProcessCard({ process: p, isSubscribed, onSubscribe, onUnsubscribe }: {
	process: BashProcess;
	isSubscribed: boolean;
	onSubscribe: () => void;
	onUnsubscribe: () => void;
}) {
	const [elapsed, setElapsed] = useState(Date.now() - p.startedAt);
	const showBackground = elapsed > 5000 && p.status === "running";

	useEffect(() => {
		if (p.status !== "running" && p.status !== "background") return;
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

	const isBackground = p.status === "background";
	const isDone = p.status === "done";
	const isError = p.status === "error";
	const isTerminated = p.status === "terminated";
	const isActive = p.status === "running";

	const statusColor = isBackground
		? "text-yellow-400"
		: isDone
			? "text-green-400"
			: isError || isTerminated
				? "text-red-400"
				: "text-blue-400";

	const statusText = isBackground
		? "后台运行"
		: isDone
			? "已完成"
			: isError
				? "错误"
				: isTerminated
					? "已取消"
					: "执行中";

	const dotColor = isBackground
		? "bg-yellow-400"
		: isDone
			? "bg-green-400"
			: isError || isTerminated
				? "bg-red-400"
				: "bg-blue-400 animate-pulse";

	return (
		<div className="rounded-lg bg-gray-900/80 border border-gray-800 p-3 space-y-2">
			<div className="flex items-start gap-2">
				<span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
				<div className="flex-1 min-w-0">
					<div className="text-[11px] font-medium text-gray-200 truncate font-mono" title={p.command}>
						{p.command}
					</div>
					<div className="flex items-center gap-3 mt-1 text-[9px] text-gray-500">
						<span className={statusColor}>{statusText}</span>
						{p.output && <span>输出: {formatOutputSize(p.output)}</span>}
						{p.pid && <span>PID: {p.pid}</span>}
						<span>{formatDuration(elapsed)}</span>
						{p.exitCode != null && <span>退出: {p.exitCode}</span>}
					</div>
				</div>
			</div>

			<div className="flex items-center gap-1.5 pt-1">
				{showBackground && isActive && (
					<button
						onClick={() => sendAction("background")}
						className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded border border-yellow-600/40 text-[10px] text-yellow-400 hover:bg-yellow-600/15 transition-colors"
						title="转为后台运行（agent 继续执行，进程保持）"
					>
						<ArrowDownToLine className="w-3 h-3" />
						<span>后台运行</span>
					</button>
				)}

				{isActive && (
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
						className="flex items-center justify-center gap-1 px-2 py-1 rounded border border-red-600/30 text-[10px] text-red-400 hover:bg-red-600/10 transition-colors shrink-0"
						title="终止进程"
					>
						<X className="w-3 h-3" />
					</button>
				)}

				{!isActive && !isBackground && <div className="flex-1" />}
				{(isActive || isBackground) && !showBackground && !isBackground && <div className="flex-1" />}
				{showBackground && isBackground && <div className="flex-1" />}

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

			{(isBackground || (p.output && !isActive)) && (
				<details className="group">
					<summary className="text-[9px] text-gray-500 cursor-pointer hover:text-gray-400 flex items-center gap-1">
						<svg className="w-2.5 h-2.5 transition-transform group-open:rotate-90" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4.5 3l3 3-3 3" /></svg>
						<span>输出</span>
					</summary>
					<div className="mt-1 space-y-1.5">
						{p.output ? (
							<pre className="text-[9px] text-gray-400 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-gray-800/50 px-1.5 py-1">
								{p.output.slice(-2000)}
							</pre>
						) : (
							<div className="text-[9px] text-gray-600 italic">无输出{isBackground ? "（后台模式默认不推送输出）" : ""}</div>
						)}
						{isBackground && (
							<div className="flex items-center gap-2">
								{isSubscribed ? (
									<button onClick={onUnsubscribe} className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-white transition-colors">
										<EyeOff className="w-3 h-3" />
										<span>取消订阅</span>
									</button>
								) : (
									<button onClick={onSubscribe} className="flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
										<Eye className="w-3 h-3" />
										<span>订阅输出</span>
									</button>
								)}
								{p.logPath && (
									<span className="text-[9px] text-gray-600 font-mono truncate" title={p.logPath}>
										<FileText className="w-3 h-3 inline mr-0.5" />
										{p.logPath.split("/").pop()}
									</span>
								)}
							</div>
						)}
					</div>
				</details>
			)}
		</div>
	);
}

export function BashPanel() {
	const activeSessionId = useSessionStore((s) => s.activeSessionId);
	const allProcesses = useBashStore(useShallow((s) => s.processesBySession[activeSessionId ?? ""]));
	const subscribedOutputs = useBashStore(useShallow((s) => s.subscribedOutputs));
	const [collapsed, setCollapsed] = useState(false);
	const [tab, setTab] = useState<"active" | "history">("active");

	const activeProcesses = allProcesses?.filter((p) =>
		p.status === "running" || p.status === "background",
	) ?? [];

	const historyProcesses = allProcesses?.filter((p) =>
		p.status === "done" || p.status === "error" || p.status === "terminated",
	) ?? [];

	useEffect(() => {
		if (activeProcesses.length === 0 && historyProcesses.length > 0 && tab === "active") {
			setTab("history");
		}
	}, [activeProcesses.length, historyProcesses.length, tab]);

	if (!allProcesses || allProcesses.length === 0) {
		return null;
	}

	const displayProcesses = tab === "active" ? activeProcesses : historyProcesses;

	return (
		<div className="px-3 py-2 space-y-2">
			<button
				onClick={() => setCollapsed(!collapsed)}
				className="w-full flex items-center gap-1.5 text-[11px] font-medium text-gray-300 hover:text-white transition-colors"
			>
				{collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
				<Terminal className="w-3 h-3" />
				<span>SHELL</span>
				<span className="ml-auto text-[9px] text-gray-600">{activeProcesses.length > 0 ? activeProcesses.length : historyProcesses.length}</span>
			</button>

			{!collapsed && (
				<>
					<div className="flex items-center gap-1 pl-1">
						<button
							onClick={() => setTab("active")}
							className={`text-[10px] px-2 py-0.5 rounded transition-colors ${tab === "active" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
						>
							运行中{activeProcesses.length > 0 ? ` (${activeProcesses.length})` : ""}
						</button>
						<button
							onClick={() => setTab("history")}
							className={`text-[10px] px-2 py-0.5 rounded transition-colors ${tab === "history" ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"}`}
						>
							历史{historyProcesses.length > 0 ? ` (${historyProcesses.length})` : ""}
						</button>
					</div>

					<div className="space-y-2 pl-1">
						{displayProcesses.length > 0 ? displayProcesses.map((p) => (
							<BashProcessCard
								key={p.toolCallId}
								process={p}
								isSubscribed={subscribedOutputs.has(p.toolCallId)}
								onSubscribe={() => useBashStore.getState().subscribeOutput(activeSessionId ?? "", p.toolCallId)}
								onUnsubscribe={() => useBashStore.getState().unsubscribeOutput(activeSessionId ?? "", p.toolCallId)}
							/>
						)) : (
							<div className="text-[10px] text-gray-600 italic pl-1">
								{tab === "active" ? "无运行中进程" : "无历史记录"}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
}
