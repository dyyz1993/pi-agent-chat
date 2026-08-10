/**
 * Issue Monitor Store — 管理 issue-monitor 扩展的运行状态 + 配置。
 *
 * 数据来源:
 * - issue-monitor.event 广播(channel data → broadcast)
 * - issue-monitor.callChannel({ method: "getStatus" | "getConfig" }) 初始加载
 *
 * 配置变更走乐观更新 + agent.setSettings 持久化 + agent.reload 生效。
 */

import { create } from "zustand";
import { apiClient } from "../lib/api-client";

/** 单个仓库的监控状态 */
export interface IssueMonitorRepoStatus {
	repo: string;
	openCount: number;
	seenCount: number;
	newCount: number;
	lastError: string | null;
}

/** 完整的 issue-monitor 运行状态(per session) */
export interface IssueMonitorStatus {
	repos: IssueMonitorRepoStatus[];
	lastScanTime: number | null;
	lastScanError: string | null;
	totalSeen: number;
	isRunning: boolean;
}

/** issue-monitor 配置(per session) */
export interface IssueMonitorConfig {
	repos: string[];
	interval: number;
	autoFix: boolean;
	labels: string[];
	branchPrefix: string;
}

/** 默认配置（extension 未返回时用） */
const DEFAULT_CONFIG: IssueMonitorConfig = {
	repos: [],
	interval: 300,
	autoFix: false,
	labels: [],
	branchPrefix: "fix/issue-",
};

interface IssueMonitorState {
	/** 按 session 隔离的运行状态 */
	statusBySession: Record<string, IssueMonitorStatus | undefined>;

	/** 按 session 隔离的配置 */
	configBySession: Record<string, IssueMonitorConfig | undefined>;

	/** 配置加载状态 */
	configLoadingBySession: Record<string, boolean>;

	/** 设置某个 session 的状态 */
	setStatus: (sessionId: string, status: IssueMonitorStatus) => void;

	/** 处理 channel 事件 */
	handleEvent: (sessionId: string, event: Record<string, unknown>) => void;

	/** 清除某个 session 的状态 + 配置 */
	clearSession: (sessionId: string) => void;

	/** 从 extension 加载配置 */
	loadConfig: (sessionId: string) => Promise<void>;

	/** 乐观更新配置 + 持久化到 settings.json + reload agent */
	saveConfig: (sessionId: string, updates: Partial<IssueMonitorConfig>) => void;
}

export const useIssueMonitorStore = create<IssueMonitorState>((set, get) => ({
	statusBySession: {},
	configBySession: {},
	configLoadingBySession: {},

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
			const nextStatus = { ...s.statusBySession };
			const nextConfig = { ...s.configBySession };
			const nextLoading = { ...s.configLoadingBySession };
			delete nextStatus[sessionId];
			delete nextConfig[sessionId];
			delete nextLoading[sessionId];
			return {
				statusBySession: nextStatus,
				configBySession: nextConfig,
				configLoadingBySession: nextLoading,
			};
		}),

	loadConfig: async (sessionId) => {
		set((s) => ({
			configLoadingBySession: { ...s.configLoadingBySession, [sessionId]: true },
		}));
		try {
			const result = await apiClient.call("issue-monitor.callChannel", {
				sessionId,
				method: "getConfig",
			});
			if (result.ok && "config" in result) {
				const cfg = result.config;
				set((s) => ({
					configBySession: {
						...s.configBySession,
						[sessionId]: {
							repos: cfg.repos ?? [],
							interval: cfg.interval ?? DEFAULT_CONFIG.interval,
							autoFix: cfg.autoFix ?? DEFAULT_CONFIG.autoFix,
							labels: cfg.labels ?? DEFAULT_CONFIG.labels,
							branchPrefix: cfg.branchPrefix ?? DEFAULT_CONFIG.branchPrefix,
						},
					},
				}));
			}
		} catch {
			// extension not running — leave config as undefined
		} finally {
			set((s) => ({
				configLoadingBySession: { ...s.configLoadingBySession, [sessionId]: false },
			}));
		}
	},

	saveConfig: (sessionId, updates) => {
		const current = get().configBySession[sessionId];
		if (!current) return;
		const next = { ...current, ...updates };

		// 乐观更新
		set((s) => ({
			configBySession: { ...s.configBySession, [sessionId]: next },
		}));

		// 持久化到 settings.json + reload agent
		(async () => {
			try {
				const settings = await apiClient.call("agent.getSettings", {
					sessionId,
					scope: "global",
				});
				const merged = {
					...(settings as Record<string, unknown>),
					issueMonitor: next,
				};
				await apiClient.call("agent.setSettings", {
					sessionId,
					scope: "global",
					settings: merged,
				});
				await apiClient.call("agent.reload", { sessionId });
			} catch {
				// 持久化失败 — 乐观更新已生效，下次 loadConfig 会恢复真实状态
			}
		})();
	},
}));
