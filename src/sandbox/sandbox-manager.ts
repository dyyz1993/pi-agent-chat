/**
 * SandboxManager — 沙箱生命周期管理
 *
 * 职责：
 *   1. 按需创建沙箱（用户来的时候）
 *   2. 跟踪沙箱活跃状态（keepAlive）
 *   3. 空闲回收（gcLoop）
 *   4. 提供沙箱端点给 SandboxRpcClient
 *
 * 当前 Demo 实现：用本地子进程模拟沙箱。
 * 当 Docker 就绪后，只需要改 createSandbox() 的实现：
 *   - 现在：child_process.spawn("bun", ["sandbox-agent.ts"])
 *   - 之后：docker run sandbox-image
 */

import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { createLogger } from "../shared/lib/logger";

const log = createLogger("sandbox-mgr");

export interface SandboxInfo {
  userId: string;
  projectPath: string;
  endpoint: string; // e.g. http://localhost:3102
  port: number;
  createdAt: number;
  lastActiveAt: number;
  process: ChildProcess | null;
}

interface SandboxConfig {
  /** 沙箱基础端口，每个用户 +1 */
  basePort: number;
  /** 空闲超时秒数 */
  idleTimeoutMs: number;
  /** 回收检查间隔 */
  gcIntervalMs: number;
  /** pi CLI 路径 */
  cliPath: string;
  /** 用户项目根目录 */
  projectsRoot: string;
}

export class SandboxManager {
  private sandboxes = new Map<string, SandboxInfo>();
  private config: SandboxConfig;
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SandboxConfig) {
    this.config = config;
    this.startGcLoop();
  }

  /** 获取用户的沙箱，没有则创建 */
  async getOrCreate(userId: string, projectPath: string): Promise<SandboxInfo> {
    const existing = this.sandboxes.get(userId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return existing;
    }
    return this.createSandbox(userId, projectPath);
  }

  /** 保活 */
  keepAlive(userId: string): void {
    const sb = this.sandboxes.get(userId);
    if (sb) sb.lastActiveAt = Date.now();
  }

  /** 销毁沙箱 */
  async destroy(userId: string): Promise<void> {
    const sb = this.sandboxes.get(userId);
    if (!sb) return;

    log.info("Destroying sandbox", { userId });
    if (sb.process && !sb.process.killed) {
      sb.process.kill("SIGTERM");
      setTimeout(() => {
        if (sb.process && !sb.process.killed) sb.process.kill("SIGKILL");
      }, 5000);
    }
    this.sandboxes.delete(userId);
    log.info("Sandbox destroyed", { userId });
  }

  /** 获取总数 */
  getActiveCount(): number {
    return this.sandboxes.size;
  }

  /** 获取所有沙箱信息 */
  getAll(): SandboxInfo[] {
    return Array.from(this.sandboxes.values());
  }

  // ─── 私有方法 ─────────────────────────────────────────

  private async createSandbox(userId: string, projectPath: string): Promise<SandboxInfo> {
    // 分配端口
    const port = this.config.basePort + this.sandboxes.size;

    log.info("Creating sandbox", { userId, projectPath, port });

    // 确保项目目录存在
    const userProjectDir = resolve(this.config.projectsRoot, userId);

    // 启动 sandbox-agent 进程
    // 注：Docker 模式时，这里替换为 docker run ...
    const proc = spawn(
      "bun",
      [
        "src/sandbox/sandbox-agent.ts",
        `--port=${port}`,
        `--cli-path=${this.config.cliPath}`,
        `--cwd=${userProjectDir}`,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: resolve(__dirname, "../.."),
        env: {
          ...process.env,
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/root/.bun/bin",
        },
      },
    );

    proc.stdout?.on("data", (d: Buffer) => log.info(`[sandbox-${userId}] ${d.toString().trim()}`));
    proc.stderr?.on("data", (d: Buffer) => log.warn(`[sandbox-${userId}] ${d.toString().trim()}`));

    const info: SandboxInfo = {
      userId,
      projectPath,
      endpoint: `http://localhost:${port}`,
      port,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      process: proc,
    };

    this.sandboxes.set(userId, info);

    // 等 sandbox-agent 就绪
    await this.waitForReady(info.endpoint);

    log.info("Sandbox ready", { userId, endpoint: info.endpoint });
    return info;
  }

  private async waitForReady(endpoint: string, maxRetries = 10): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`${endpoint}/health`);
        if (res.ok) return;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Sandbox ${endpoint} did not become ready`);
  }

  private startGcLoop(): void {
    this.gcTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, sb] of this.sandboxes) {
        if (now - sb.lastActiveAt > this.config.idleTimeoutMs) {
          log.info("GC: recycling idle sandbox", { userId, idleMs: now - sb.lastActiveAt });
          this.destroy(userId).catch((err) => {
            log.warn("GC destroy failed", { userId, error: String(err) });
          });
        }
      }
    }, this.config.gcIntervalMs);
  }

  stop(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    for (const userId of this.sandboxes.keys()) {
      this.destroy(userId).catch(() => {});
    }
  }
}
