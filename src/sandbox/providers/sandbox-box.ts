/**
 * SandboxBoxProvider — 自建 sandbox-box 沙盒（Linux namespace 隔离）
 *
 * 通过 SSH 管理沙盒，本地运行 sandbox-agent 通过 SSH JSONL 管道
 * 与沙盒内的 pi --mode rpc 通信。
 *
 * 链路：
 *   SandboxRpcClient → HTTP → localhost:PORT
 *   → sandbox-agent (SSH JSONL) → SSH → NAS sandbox → pi --mode rpc
 */

import { spawn } from "child_process";
import { resolve } from "path";
import { createLogger } from "../../shared/lib/logger";
import type { ISandboxProvider, SandboxInstance, SandboxProviderConfig } from "../types";

const log = createLogger("sandbox-box");

export interface SandboxBoxProviderOptions {
  /** SSH 连接地址 */
  sshHost: string;
  /** SSH 端口 */
  sshPort: number;
  /** SSH 用户 */
  sshUser: string;
  /** SSH 密钥路径 */
  sshKeyPath?: string;
  /** 沙盒域名后缀 */
  domainSuffix: string;
  /** sandbox-agent 本地端口基值 */
  basePort?: number;
}

interface LocalBridge {
  process: ReturnType<typeof spawn>;
  port: number;
}

export class SandboxBoxProvider implements ISandboxProvider {
  private sandboxes = new Map<string, SandboxInstance>();
  private bridges = new Map<string, LocalBridge>();
  private options: SandboxBoxProviderOptions;

  constructor(options: SandboxBoxProviderOptions) {
    this.options = options;
  }

  async getOrCreate(userId: string, _config: SandboxProviderConfig): Promise<SandboxInstance> {
    const sandboxName = `user-${userId}`;

    const existing = this.sandboxes.get(userId);
    if (existing && existing.status === "running") {
      existing.lastActiveAt = Date.now();
      return existing;
    }

    // 1. 创建/恢复沙盒
    const out = await this.execSsh(`sandbox list 2>/dev/null | grep -w '${sandboxName}' || true`);
    if (out.trim()) {
      log.info("Resuming sandbox", { sandboxName });
      await this.execSsh(`sandbox resume ${sandboxName} --port 3200 2>/dev/null || true`);
    } else {
      log.info("Creating sandbox", { sandboxName });
      await this.execSsh(`sandbox create ${sandboxName} --port 3200 2>&1 || true`);
      const created = await this.execSsh(
        `sandbox list 2>/dev/null | grep -w '${sandboxName}' || true`,
      );
      if (!created.trim()) throw new Error(`Failed to create sandbox '${sandboxName}'`);
    }

    // 2. 杀掉沙盒内默认的 HTTP preview（占着 3100）
    await this.execSsh(
      `sandbox ${sandboxName} 'pkill -9 python3 2>/dev/null; pkill -9 python 2>/dev/null' 2>&1 || true`,
    );

    // 3. 启动本地 sandbox-agent，通过 SSH 连到沙盒内的 pi
    const port = await this.startBridge(userId, sandboxName);

    const instance: SandboxInstance = {
      userId,
      status: "running",
      endpoint: `http://localhost:${port}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.sandboxes.set(userId, instance);
    log.info("Sandbox ready", { userId, endpoint: instance.endpoint });
    return instance;
  }

  async destroy(userId: string): Promise<void> {
    const sandboxName = `user-${userId}`;
    log.info("Destroying sandbox", { sandboxName });

    // 停本地 bridge
    const bridge = this.bridges.get(userId);
    if (bridge && !bridge.process.killed) {
      bridge.process.kill("SIGTERM");
    }
    this.bridges.delete(userId);

    // 销毁沙盒
    try {
      await this.execSsh(`sandbox destroy ${sandboxName} 2>&1 || true`);
    } catch (err) {
      log.warn("Destroy failed", { userId, error: String(err) });
    }

    this.sandboxes.delete(userId);
  }

  async getStatus(userId: string): Promise<SandboxInstance | null> {
    const sandboxName = `user-${userId}`;
    try {
      const out = await this.execSsh(`sandbox health ${sandboxName} 2>&1 || true`);
      const running =
        out.toLowerCase().includes("running") || out.toLowerCase().includes("healthy");
      const cached = this.sandboxes.get(userId);
      if (cached) {
        cached.status = running ? "running" : "stopped";
        return cached;
      }
      return null;
    } catch {
      return null;
    }
  }

  keepAlive(userId: string): void {
    const sb = this.sandboxes.get(userId);
    if (sb) sb.lastActiveAt = Date.now();
  }

  async shutdown(): Promise<void> {
    for (const userId of this.bridges.keys()) {
      const b = this.bridges.get(userId);
      if (b && !b.process.killed) b.process.kill("SIGTERM");
    }
    this.bridges.clear();
    for (const userId of this.sandboxes.keys()) {
      await this.destroy(userId);
    }
  }

  // ─── Private ────────────────────────────────────

  private async startBridge(userId: string, sandboxName: string): Promise<number> {
    const port = (this.options.basePort ?? 3200) + this.bridges.size + 1;

    const keyFlag = this.options.sshKeyPath ? `--ssh-key=${this.options.sshKeyPath}` : "";

    const args = [
      "src/sandbox/sandbox-agent.ts",
      `--port=${port}`,
      `--ssh-host=${this.options.sshHost}`,
      `--ssh-port=${this.options.sshPort}`,
      `--ssh-user=${this.options.sshUser}`,
      `--ssh-sandbox=${sandboxName}`,
      keyFlag,
    ].filter(Boolean);

    log.info("Starting bridge", { userId, port, sandboxName });

    const proc = spawn("bun", args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: resolve(__dirname, "../../.."),
    });

    proc.stdout?.on("data", (d: Buffer) => log.info(`[bridge-${userId}] ${d.toString().trim()}`));
    proc.stderr?.on("data", (d: Buffer) => log.warn(`[bridge-${userId}] ${d.toString().trim()}`));

    this.bridges.set(userId, { process: proc, port });

    // 等待就绪
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.ok) return port;
      } catch {
        /* not ready */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    throw new Error(`Bridge for '${sandboxName}' did not become ready`);
  }

  private async execSsh(command: string): Promise<string> {
    const { sshHost, sshPort, sshUser, sshKeyPath } = this.options;
    const keyFlag = sshKeyPath ? `-i ${sshKeyPath}` : "";
    const cmd = `ssh ${keyFlag} -p ${sshPort} -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${sshUser}@${sshHost} ${JSON.stringify(command)}`;

    return new Promise((resolve, reject) => {
      const proc = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on("close", (code) => {
        if (code === 0 || code === null) resolve(stdout);
        else reject(new Error(`SSH exec failed (${code}): ${stderr || stdout.slice(0, 200)}`));
      });
      proc.on("error", reject);
    });
  }
}
