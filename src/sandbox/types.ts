/**
 * ISandboxProvider — 沙盒后端统一接口
 *
 * 三个实现：
 *   - LocalProcessProvider  — 本地子进程（开发用）
 *   - SandboxBoxProvider    — 自建 sandbox-box（Docker namespace）
 *   - CloudflareProvider    — Cloudflare Containers（上云用）
 */

export type SandboxStatus = "creating" | "starting" | "ready" | "running" | "stopped" | "error";

export interface SandboxInstance {
  id?: string;
  userId: string;
  projectPath?: string;
  status: SandboxStatus;
  /** HTTP 端点，供 SandboxRpcClient 连接 */
  endpoint: string;
  projectPath?: string;
  sandboxName?: string;
  sandboxPid?: number;
  localPort?: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后活跃时间 */
  lastActiveAt: number;
  /** 沙盒名称（sandbox-box 专用） */
  sandboxName?: string;
  /** 沙盒进程 PID（sandbox-box 专用） */
  sandboxPid?: number;
  /** 本地隧道端口（sandbox-box 专用） */
  localPort?: number;
}

export interface ISandboxProvider {
  /** 获取或创建用户沙盒 */
  getOrCreate(userId: string, projectPath: string): Promise<SandboxInstance>;

  /** 销毁用户沙盒 */
  destroy(userId: string): Promise<void>;

  /** 获取沙盒状态 */
  getStatus(userId: string): Promise<SandboxInstance | null>;

  /** 保活（重置空闲计时器） */
  keepAlive(userId: string): void;

  /** 关闭所有沙盒 */
  shutdown(): Promise<void>;

  /** 可选：在沙盒命名空间内执行命令，仅部分 provider 支持 */
  execInSandbox?(userId: string, cmd: string): Promise<string>;
}
