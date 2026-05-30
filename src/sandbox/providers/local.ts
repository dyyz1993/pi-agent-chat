/**
 * LocalProcessProvider — 本地子进程沙盒（开发用）
 *
 * 从原 SandboxManager.createSandbox() 搬迁而来。
 * spawn sandbox-agent.ts → sandbox-agent 再 spawn pi CLI。
 */

import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { createLogger } from "../../shared/lib/logger";
import { getProjectRoot, getSandboxAgentPath, getSandboxAgentRunner } from "../../shared/lib/paths";
import type {
  ISandboxProvider,
  SandboxInstance,
  SandboxProviderConfig,
  SandboxStatus,
} from "../types";

const log = createLogger("sandbox-local");

interface LocalSandboxState {
  userId: string;
  endpoint: string;
  port: number;
  process: ChildProcess;
  createdAt: number;
  lastActiveAt: number;
  status: SandboxStatus;
}

export interface LocalProcessProviderOptions {
  basePort: number;
  cliPath: string;
  projectsRoot: string;
}

export class LocalProcessProvider implements ISandboxProvider {
  private sandboxes = new Map<string, LocalSandboxState>();
  private options: LocalProcessProviderOptions;

  constructor(options: LocalProcessProviderOptions) {
    this.options = options;
  }

  async getOrCreate(userId: string, _config: SandboxProviderConfig): Promise<SandboxInstance> {
    const existing = this.sandboxes.get(userId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return this.toInstance(existing);
    }
    return this.createSandbox(userId);
  }

  async destroy(userId: string): Promise<void> {
    const sb = this.sandboxes.get(userId);
    if (!sb) return;

    log.info("Destroying local sandbox", { userId });
    if (sb.process && !sb.process.killed) {
      sb.process.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (sb.process && !sb.process.killed) sb.process.kill("SIGKILL");
          resolve();
        }, 5000);
      });
    }
    this.sandboxes.delete(userId);
  }

  async getStatus(userId: string): Promise<SandboxInstance | null> {
    const sb = this.sandboxes.get(userId);
    return sb ? this.toInstance(sb) : null;
  }

  keepAlive(userId: string): void {
    const sb = this.sandboxes.get(userId);
    if (sb) sb.lastActiveAt = Date.now();
  }

  async shutdown(): Promise<void> {
    for (const userId of this.sandboxes.keys()) {
      await this.destroy(userId);
    }
  }

  private async createSandbox(userId: string): Promise<SandboxInstance> {
    const port = this.options.basePort + this.sandboxes.size;
    const userProjectDir = resolve(this.options.projectsRoot, userId);

    log.info("Creating local sandbox", { userId, port });

    const proc = spawn(
      getSandboxAgentRunner(),
      [
        getSandboxAgentPath(),
        `--port=${port}`,
        `--cli-path=${this.options.cliPath}`,
        `--cwd=${userProjectDir}`,
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: getProjectRoot(),
        env: {
          ...process.env,
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/root/.bun/bin",
        },
      },
    );

    proc.stdout?.on("data", (d: Buffer) => log.info(`[sandbox-${userId}] ${d.toString().trim()}`));
    proc.stderr?.on("data", (d: Buffer) => log.warn(`[sandbox-${userId}] ${d.toString().trim()}`));

    const state: LocalSandboxState = {
      userId,
      endpoint: `http://localhost:${port}`,
      port,
      process: proc,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      status: "creating",
    };

    this.sandboxes.set(userId, state);

    await this.waitForReady(state.endpoint);
    state.status = "running";

    log.info("Local sandbox ready", { userId, endpoint: state.endpoint });
    return this.toInstance(state);
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

  private toInstance(sb: LocalSandboxState): SandboxInstance {
    return {
      userId: sb.userId,
      status: sb.status,
      endpoint: sb.endpoint,
      createdAt: sb.createdAt,
      lastActiveAt: sb.lastActiveAt,
    };
  }
}
