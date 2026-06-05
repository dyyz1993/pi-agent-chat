import { memo, useMemo } from "react";
import {
	CheckCircle,
	XCircle,
	Terminal,
	Eye,
	Pencil,
	FileText,
	Search,
	FolderOpen,
	Wrench,
	Shield,
	ChevronUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIDialogStore, type UIPendingRequest } from "../../stores/use-ui-dialog-store";
import { useSessionStore } from "../../stores/use-session-store";

const HOOK_TOOL_ICONS: Record<string, { icon: typeof Terminal; color: string; label: string }> = {
	bash: { icon: Terminal, color: "text-orange-400", label: "Bash" },
	read: { icon: Eye, color: "text-blue-400", label: "Read" },
	write: { icon: FileText, color: "text-green-400", label: "Write" },
	edit: { icon: Pencil, color: "text-amber-400", label: "Edit" },
	grep: { icon: Search, color: "text-purple-400", label: "Grep" },
	find: { icon: FolderOpen, color: "text-cyan-400", label: "Find" },
	ls: { icon: FolderOpen, color: "text-cyan-400", label: "Ls" },
};

function SinglePermissionCard({ req }: { req: UIPendingRequest }) {
	const { t } = useTranslation("chat");
	const respondById = useUIDialogStore((s) => s.respondById);
	const dismissById = useUIDialogStore((s) => s.dismissById);

	const hookMeta = req.hookMeta;
	const hookIcon = hookMeta?.toolName
		? HOOK_TOOL_ICONS[hookMeta.toolName.toLowerCase()] ?? {
				icon: Wrench,
				color: "text-gray-400",
				label: hookMeta.toolName,
			}
		: { icon: Shield, color: "text-status-warning", label: "Permission" };

	const Icon = hookIcon.icon;

	return (
		<div className="flex items-start gap-2 px-3 py-2">
			<div className={`flex items-center gap-1.5 shrink-0 mt-0.5 ${hookIcon.color}`}>
				<Icon className="w-4 h-4" />
				<span className="text-[11px] font-semibold">{hookIcon.label}</span>
			</div>
			<div className="flex-1 min-w-0">
				{hookMeta?.reason && (
					<p className="text-[11px] text-text-secondary leading-relaxed mb-1">
						{hookMeta.reason}
					</p>
				)}
				{hookMeta?.command && (
					<div className="bg-black/30 dark:bg-black/40 rounded px-2 py-1 flex items-start gap-1.5">
						<span className="text-text-tertiary text-[10px] shrink-0 mt-0.5">$</span>
						<code className="text-[11px] text-text-primary font-mono break-all leading-relaxed flex-1">
							{hookMeta.command}
						</code>
					</div>
				)}
				{!hookMeta?.command && req.message && (
					<p className="text-[11px] text-text-secondary leading-relaxed">{req.message}</p>
				)}
			</div>
			<div className="flex items-center gap-1.5 shrink-0">
				<button
					onClick={() => respondById(req.requestId, { confirmed: true })}
					className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-status-success text-white dark:bg-status-success/20 dark:text-status-success hover:bg-status-success/90 dark:hover:bg-status-success/30 text-[11px] font-medium transition-colors"
				>
					<CheckCircle className="w-3 h-3" />
					{t("uiCard.allowOnce")}
				</button>
				<button
					onClick={() => dismissById(req.requestId)}
					className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-status-error/15 text-status-error hover:bg-status-error/25 text-[11px] font-medium transition-colors"
				>
					<XCircle className="w-3 h-3" />
					{t("hookPermission.deny")}
				</button>
			</div>
		</div>
	);
}

function CollapsedSummary({ count, req }: { count: number; req: UIPendingRequest }) {
	const { t } = useTranslation("chat");
	const togglePanel = useUIDialogStore((s) => s.togglePanel);

	const hookMeta = req.hookMeta;
	const hookIcon = hookMeta?.toolName
		? HOOK_TOOL_ICONS[hookMeta.toolName.toLowerCase()] ?? {
				icon: Wrench,
				color: "text-gray-400",
				label: hookMeta.toolName,
			}
		: { icon: Shield, color: "text-status-warning", label: "" };

	const Icon = hookIcon.icon;

	return (
		<button
			onClick={togglePanel}
			className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-hover/30 transition-colors"
		>
			<Icon className={`w-4 h-4 shrink-0 ${hookIcon.color}`} />
			<span className="text-[11px] font-medium text-status-warning flex-1 text-left">
				{t("hookPermission.multiplePending", { count })}
			</span>
			<span className="flex items-center gap-1 text-[10px] text-text-tertiary">
				{t("hookPermission.viewAll")}
				<ChevronUp className="w-3 h-3" />
			</span>
		</button>
	);
}

export const HookPermissionBanner = memo(function HookPermissionBanner({
	sessionId,
}: {
	sessionId: string;
}) {
	const { t } = useTranslation("chat");
	const allPending = useUIDialogStore((s) => s.pending);
	const activeProjectId = useSessionStore((s) => s.activeProjectId);
	const projectTabs = useSessionStore((s) => s.projectTabs);
	const sessionsByProject = useSessionStore((s) => s.sessionsByProject);

	const projectSessions = useMemo(() => {
		if (!activeProjectId) return [];
		const tab = projectTabs.find((item) => item.id === activeProjectId);
		if (!tab) return [];
		return sessionsByProject[tab.path] ?? [];
	}, [activeProjectId, projectTabs, sessionsByProject]);

	const sessionNameMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const session of projectSessions) {
			map.set(
				session.sessionId,
				session.name || session.firstMessage?.slice(0, 30) || session.sessionId.slice(0, 8),
			);
		}
		return map;
	}, [projectSessions]);

	const sessionPending = useMemo(() => {
		const projectSessionIds = new Set(projectSessions.map((session) => session.sessionId));
		if (projectSessionIds.size === 0) projectSessionIds.add(sessionId);
		return allPending
			.filter(
				(request) =>
					projectSessionIds.has(request.sessionId) &&
					request.hookMeta &&
					request.method === "confirm",
			)
			.sort((a, b) => {
				if (a.sessionId === sessionId && b.sessionId !== sessionId) return -1;
				if (b.sessionId === sessionId && a.sessionId !== sessionId) return 1;
				return 0;
			});
	}, [allPending, projectSessions, sessionId]);

	if (sessionPending.length === 0) return null;

	const firstReq = sessionPending[0];
	const showSessionJump = firstReq.sessionId !== sessionId;

	return (
		<div className="flex-shrink-0 border-t border-status-warning/30 bg-status-warning/5 dark:bg-status-warning/10 animate-in fade-in slide-in-from-bottom duration-200">
			{showSessionJump && (
				<div className="flex items-center gap-2 px-3 pt-2 text-[10px] text-text-tertiary">
					<span className="truncate">
						{sessionNameMap.get(firstReq.sessionId) ?? firstReq.sessionId.slice(0, 8)}
					</span>
					<button
						onClick={() => useSessionStore.getState().setActiveSession(firstReq.sessionId)}
						className="ml-auto text-semantic-accent hover:text-semantic-accent/80 transition-colors"
					>
						{t("uiPending.gotoSession")}
					</button>
				</div>
			)}
			{sessionPending.length === 1 ? (
				<SinglePermissionCard req={firstReq} />
			) : (
				<>
					<CollapsedSummary count={sessionPending.length} req={firstReq} />
					<div className="border-t border-status-warning/20">
						<SinglePermissionCard req={firstReq} />
					</div>
				</>
			)}
		</div>
	);
});
