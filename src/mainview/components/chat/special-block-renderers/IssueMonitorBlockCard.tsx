import { memo, useState } from "react";
import { Radar, ChevronDown, ChevronRight, ExternalLink, GitBranch } from "lucide-react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

/**
 * IssueMonitorBlockCard — 在聊天消息流里渲染 issue-monitor 发现的 issue 卡片。
 *
 * 扩展发 <issue-monitor repo="..." number="..." title="..." url="..." status="new">body</issue-monitor>
 * 这个组件把它渲染成带状态徽章的卡片。
 */
export const IssueMonitorBlockCard = memo(function IssueMonitorBlockCard({
	block,
}: SpecialBlockRendererProps) {
	const [expanded, setExpanded] = useState(false);
	const repo = block.attrs?.repo ?? "unknown";
	const number = block.attrs?.number ?? "?";
	const title = block.attrs?.title ?? "Untitled";
	const url = block.attrs?.url ?? "";
	const status = block.attrs?.status ?? "new";

	const statusColor =
		status === "new"
			? "bg-status-warning/20 text-status-warning"
			: status === "fixed"
				? "bg-status-success/20 text-status-success"
				: "bg-surface-hover text-text-tertiary";

	const statusLabel = status === "new" ? "待修复" : status === "fixed" ? "已修复" : status;

	return (
		<div className="my-2 rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
			{/* Header */}
			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover transition-colors"
			>
				{expanded ? (
					<ChevronDown className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
				) : (
					<ChevronRight className="w-3.5 h-3.5 text-text-tertiary shrink-0" />
				)}
				<Radar className="w-4 h-4 text-accent shrink-0" />
				<span className="text-xs font-mono text-text-secondary shrink-0">#{number}</span>
				<span className="text-sm text-text-primary truncate flex-1 text-left">{title}</span>
				<span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${statusColor}`}>
					{statusLabel}
				</span>
				{url && (
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						onClick={(e) => e.stopPropagation()}
						className="shrink-0 text-text-tertiary hover:text-accent transition-colors"
					>
						<ExternalLink className="w-3.5 h-3.5" />
					</a>
				)}
			</button>

			{/* Meta line */}
			<div className="flex items-center gap-2 px-3 pb-1.5 -mt-0.5">
				<span className="text-[11px] text-text-tertiary truncate">{repo}</span>
				<GitBranch className="w-3 h-3 text-text-tertiary shrink-0" />
				<span className="text-[11px] text-text-tertiary font-mono shrink-0">
					auto-fix/issue-{number}
				</span>
			</div>

			{/* Body */}
			{expanded && block.body && (
				<div className="px-3 pb-2.5 border-t border-border-primary/50 pt-2">
					<pre className="text-xs text-text-secondary whitespace-pre-wrap break-words font-sans max-h-48 overflow-y-auto">
						{block.body}
					</pre>
				</div>
			)}
		</div>
	);
});

registerSpecialBlock("issue-monitor", IssueMonitorBlockCard);
