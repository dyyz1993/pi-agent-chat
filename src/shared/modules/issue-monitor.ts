/**
 * Issue Monitor module types — RPC methods + events for issue-monitor extension.
 *
 * issue-monitor extension 注册 channel "issue-monitor"，提供 getStatus / getConfig 方法。
 * 前端通过 issue-monitor.callChannel RPC → server handler → process-manager.callChannel
 * 与 extension 通信。Extension emit 的 status 事件通过 channel_data → "issue-monitor.event"
 * 推送到所有订阅的前端。
 */

export interface IssueMonitorRepoStatus {
  repo: string;
  openCount: number;
  seenCount: number;
  newCount: number;
  lastError: string | null;
}

export interface IssueMonitorStatusPayload {
  repos: IssueMonitorRepoStatus[];
  lastScanTime: number | null;
  lastScanError: string | null;
  totalSeen: number;
  isRunning: boolean;
}

export interface IssueMonitorConfig {
  repos: string[];
  interval: number;
  labels: string[];
  autoFix: boolean;
  branchPrefix: string;
  githubToken: string;
}

/** Extension channel getStatus 返回的内容（status payload 或 error） */
export type IssueMonitorChannelResult =
  | { ok: true; data: IssueMonitorStatusPayload }
  | { ok: true; config: IssueMonitorConfig }
  | { ok: false; error: string };

export interface IssueMonitorMethods {
  "issue-monitor.callChannel": {
    params: {
      sessionId: string;
      method: "getStatus" | "getConfig";
    };
    result: IssueMonitorChannelResult;
  };
}

export interface IssueMonitorEvents {
  "issue-monitor.event": { sessionId: string } & Record<string, unknown>;
}
