import { useState, useEffect, useRef, useCallback } from "react";
import {
	ChevronDown,
	ChevronRight,
	Terminal,
	ArrowDownToLine,
	X,
	Trash2,
	Loader2,
	Send,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSessionStore } from "../../stores/use-session-store";
import { useBashStore } from "../../stores/use-bash-store";
import type { BashProcess } from "../../../shared/modules/bash";
import { apiClient } from "../../lib/api-client";

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m${s % 60}s`;
}

function BashProcessCard({ process: p, onOpenLog }: {
	process: BashProcess;
	onOpenLog: () => void;
}) {
	const [elapsed, setElapsed] = useState(Date.now() - p.startedAt);

	useEffect(() => {
		if (p.status !== "running" && p.status !== "background") return;
		setElapsed(Date.now() - p.startedAt);
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

	const isRunning = p.status === "running";
	const isBackground = p.status === "background";
	const isActive = isRunning || isBackground;
	const isEnded = p.status === "done" || p.status === "error" || p.status === "terminated";

	const statusColor = isBackground
		? "text-yellow-400"
		: p.status === "done"
			? "text-green-400"
			: p.status === "error" || p.status === "terminated"
				? "text-red-400"
				: "text-blue-400";

	const statusText = isBackground
		? "后台运行"
		: p.status === "done"
			? "已完成"
			: p.status === "error"
				? "错误"
				: p.status === "terminated"
					? "已取消"
					: "执行中";

	return (
		<div className="rounded-lg bg-gray-900/80 border border-gray-800 px-3 py-2.5 space-y-1.5">
			<div className="flex items-center gap-2">
				<span className="text-[11px] font-medium text-gray-200 truncate font-mono flex-1" title={p.command}>
					{p.command}
				</span>
			</div>
			<div className="flex items-center gap-3 text-[9px] text-gray-500">
				<span className={statusColor}>{statusText}</span>
				{isActive ? (
					<span>运行: {formatDuration(elapsed)}</span>
				) : (
					p.endedAt && <span>耗时: {formatDuration(p.endedAt - p.startedAt)}</span>
				)}
			</div>
			<div className="flex items-center gap-1.5 pt-0.5">
				<button
					onClick={onOpenLog}
					className="flex items-center justify-center w-8 h-7 rounded border border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600 transition-colors shrink-0"
					title="查看日志"
				>
					<Terminal className="w-3.5 h-3.5" />
				</button>

				{isActive && (
					<button
						onClick={() => sendAction("kill")}
						className="flex items-center justify-center w-8 h-7 rounded border border-red-600/30 text-red-400 hover:bg-red-600/10 transition-colors shrink-0"
						title={isRunning ? "取消执行" : "终止进程"}
					>
						<X className="w-3.5 h-3.5" />
					</button>
				)}

				{isRunning && !isBackground && elapsed > 5000 && (
					<button
						onClick={() => sendAction("background")}
						className="flex items-center justify-center w-auto px-2 h-7 rounded border border-yellow-600/40 text-[10px] text-yellow-400 hover:bg-yellow-600/15 transition-colors shrink-0"
						title="转为后台运行"
					>
						<ArrowDownToLine className="w-3 h-3 mr-1" />
						<span>后台</span>
					</button>
				)}

				{isEnded && (
					<button
						onClick={() => useBashStore.getState().removeProcess(
							useSessionStore.getState().activeSessionId ?? "",
							p.toolCallId,
						)}
						className="flex items-center justify-center w-8 h-7 rounded border border-gray-700/50 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors shrink-0"
						title="从列表移除"
					>
						<Trash2 className="w-3.5 h-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}

function LogViewer({ logPath, toolCallId, onClose }: { logPath: string; toolCallId: string; onClose: () => void }) {
	const [lines, setLines] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [totalLines, setTotalLines] = useState(0);
	const [hasMore, setHasMore] = useState(false);
	const [autoScroll, setAutoScroll] = useState(true);
	const [stdinInput, setStdinInput] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const offsetRef = useRef(0);
	const mountedRef = useRef(true);
	const loadingRef = useRef(false);
	const initTag = useRef(0);

	const loadHistory = useCallback(async (tag: number) => {
		if (loadingRef.current) return;
		loadingRef.current = true;
		try {
			const result = await apiClient.call("bash.readLog", {
				logPath,
				offset: offsetRef.current,
				limit: 500,
			}) as { lines: string[]; totalLines: number; hasMore: boolean };
			if (!mountedRef.current || initTag.current !== tag) return;
			setLines((prev) => (offsetRef.current === 0 ? result.lines : [...prev, ...result.lines]));
			setTotalLines(result.totalLines);
			setHasMore(result.hasMore);
			offsetRef.current += result.lines.length;
		} catch {
			if (!mountedRef.current || initTag.current !== tag) return;
		} finally {
			if (mountedRef.current && initTag.current === tag) { setLoading(false); loadingRef.current = false; }
		}
	}, [logPath]);

	useEffect(() => {
		const tag = ++initTag.current;
		mountedRef.current = true;
		offsetRef.current = 0;
		loadingRef.current = false;
		setLoading(true);
		setLines([]);
		setTotalLines(0);
		setHasMore(false);

		const unsub = apiClient.subscribe("bash.logUpdate", (payload: { logPath: string; newLines: string[] }) => {
			if (payload.logPath !== logPath || initTag.current !== tag) return;
			if (payload.newLines.length === 0) return;
			setLines((prev) => [...prev, ...payload.newLines]);
			setTotalLines((prev) => prev + payload.newLines.length);
		});

		loadHistory(tag);
		apiClient.call("bash.watchLog", { logPath }).catch(() => {});

		return () => {
			mountedRef.current = false;
			unsub.then((id) => apiClient.unsubscribe(id));
			apiClient.call("bash.unwatchLog", { logPath }).catch(() => {});
		};
	}, [logPath, loadHistory]);

	useEffect(() => {
		if (autoScroll && containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
	}, [lines, autoScroll]);

	function handleScroll() {
		const el = containerRef.current;
		if (!el) return;
		const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
		setAutoScroll(nearBottom);
		if (nearBottom && hasMore && !loadingRef.current) loadHistory(initTag.current);
	}

	async function sendStdin() {
		const text = stdinInput.trim();
		if (!text) return;
		const sid = useSessionStore.getState().activeSessionId;
		if (!sid || !toolCallId) return;
		await apiClient.call("bash.command", { sessionId: sid, action: "write_stdin" as const, toolCallId, data: text + "\n" });
		setStdinInput("");
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" onClick={onClose}>
			<div
				className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-4xl flex flex-col h-[85vh] sm:h-[70vh]"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						<Terminal className="w-3.5 h-3.5 text-gray-500 shrink-0" />
						<span className="text-xs text-gray-300 font-mono truncate">{logPath.split("/").pop()}</span>
						<span className="text-[9px] text-gray-600 shrink-0">{totalLines} 行</span>
					</div>
					<button onClick={onClose} className="text-gray-500 hover:text-white text-sm leading-none shrink-0">✕</button>
				</div>

				<div
					ref={containerRef}
					onScroll={handleScroll}
					className="flex-1 overflow-auto p-3 sm:p-4 min-h-0"
				>
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<Loader2 className="w-4 h-4 animate-spin text-gray-500" />
							<span className="ml-2 text-[11px] text-gray-500">加载中...</span>
						</div>
					) : lines.length === 0 ? (
						<div className="text-[11px] text-gray-600 italic">暂无输出</div>
					) : (
						<pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
							{lines.join("\n")}
						</pre>
					)}
				</div>

				<div className="flex items-center gap-2 px-3 sm:px-4 py-2 border-t border-gray-700 shrink-0">
					<span className="text-[9px] text-gray-600 shrink-0">{lines.length}/{totalLines}</span>
					<button onClick={() => setAutoScroll(true)} className="text-[9px] text-gray-500 hover:text-gray-400 transition-colors shrink-0">
						滚动到底部
					</button>
					<div className="flex-1 flex items-center gap-1.5 ml-2">
						<input
							ref={inputRef}
							value={stdinInput}
							onChange={(e) => setStdinInput(e.target.value)}
							onKeyDown={(e) => { if (e.key === "Enter") sendStdin(); }}
							placeholder="输入内容发送到进程..."
							className="flex-1 h-7 px-2 rounded bg-gray-800 border border-gray-700 text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-gray-500 font-mono"
						/>
						<button
							onClick={sendStdin}
							disabled={!stdinInput.trim()}
							className="h-7 w-7 flex items-center justify-center rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 disabled:opacity-30 disabled:hover:bg-blue-600/20 transition-colors shrink-0"
							title="发送"
						>
							<Send className="w-3.5 h-3.5" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

export { BashProcessCard, LogViewer };

export function BashPanel() {
	const activeSessionId = useSessionStore((s) => s.activeSessionId);
	const allProcesses = useBashStore(useShallow((s) => s.processesBySession[activeSessionId ?? ""]));
	const [collapsed, setCollapsed] = useState(false);
	const [logViewer, setLogViewer] = useState<{ logPath: string; toolCallId: string } | null>(null);

	const backgroundProcesses = allProcesses?.filter((p) =>
		p.status === "background" || p.status === "done" || p.status === "error" || p.status === "terminated",
	) ?? [];

	if (backgroundProcesses.length === 0) return null;

	return (
		<div className="px-3 py-2 space-y-2">
			<button
				onClick={() => setCollapsed(!collapsed)}
				className="w-full flex items-center gap-1.5 text-[11px] font-medium text-gray-300 hover:text-white transition-colors"
			>
				{collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
				<Terminal className="w-3 h-3" />
				<span>SHELL</span>
				<span className="ml-auto text-[9px] text-gray-600">{backgroundProcesses.length}</span>
			</button>

			{!collapsed && (
				<div className="space-y-2 pl-1">
					{backgroundProcesses.map((p) => (
						<BashProcessCard
							key={p.toolCallId}
							process={p}
							onOpenLog={() => setLogViewer({ logPath: p.logPath ?? "", toolCallId: p.toolCallId })}
						/>
					))}
				</div>
			)}

			{logViewer && (
				<LogViewer logPath={logViewer.logPath} toolCallId={logViewer.toolCallId} onClose={() => setLogViewer(null)} />
			)}
		</div>
	);
}
