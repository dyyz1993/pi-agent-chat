/**
 * Issue Monitor Store — 管理 issue-monitor 扩展的状态。
 *
 * 数据来源:
 * - issue-monitor.event 广播(channel data → broadcast)
 * - agent.callChannel("issue-monitor", "getStatus") 初始加载
 */

import { create } from "zustand";

/** 单个仓库的监控状态 */
export interface IssueMonitorRepoStatus {
	repo: string;
	openCount: number;
	seenCount: number;
	newCount: number;
	lastError: string | null;
}

/** 完整的 issue-monitor 状态(per session) */
export interface IssueMonitorStatus {
	repos: IssueMonitorRepoStatus[];
	lastScanTime: number | null;
	lastScanError: string | null;
	totalSeen: number;
	isRunning: boolean;
}

interface IssueMonitorState {
	/** 按 session 隔离的状态 */
	statusBySession: Record<string, IssueMonitorStatus | undefined>;

	/** 设置某个 session 的状态 */
	setStatus: (sessionId: string, status: IssueMonitorStatus) => void;

	/** 处理 channel 事件 */
	handleEvent: (sessionId: string, event: Record<string, unknown>) => void;

	/** 清除某个 session 的状态 */
	clearSession: (sessionId: string) => void;
}

export const useIssueMonitorStore = create<IssueMonitorState>((set) => ({
	statusBySession: {},

	setStatus: (sessionId, status) =>
		set((s) => ({
			statusBySession: { ...s.statusBySession, [sessionId]: status },
		})),

	handleEvent: (sessionId, event) => {
		const type = event.type as string;
		if (type === "status") {
			const status: IssueMonitorStatus = {
				repos: (event.repos as IssueMonitorRepoStatus[]) ?? [],
				lastScanTime: (event.lastScanTime as number) ?? null,
				lastScanError: (event.lastScanError as string) ?? null,
				totalSeen: (event.totalSeen as number) ?? 0,
				isRunning: (event.isRunning as boolean) ?? false,
			};
			set((s) => ({
				statusBySession: { ...s.statusBySession, [sessionId]: status },
			}));
		}
	},

	clearSession: (sessionId) =>
		set((s) => {
			const next = { ...s.statusBySession };
			delete next[sessionId];
			return { statusBySession: next };
		}),
}));
