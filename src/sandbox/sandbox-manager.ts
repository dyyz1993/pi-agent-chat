/**
 * SandboxManager — 沙盒生命周期管理（Provider 模式）
 *
 * 职责：
 *   1. 按需创建沙箱（用户来的时候）
 *   2. 跟踪沙箱活跃状态（keepAlive）
 *   3. 空闲回收（gcLoop）
 *   4. 提供沙盒端点给 SandboxRpcClient
 *
 * 通过 ISandboxProvider 接口支持多后端：
 *   - local     → LocalProcessProvider（开发用）
 *   - sandbox-box → SandboxBoxProvider（自建 Docker）
 *   - cloudflare → CloudflareSandboxProvider（上云）
 */

import { createLogger } from "../shared/lib/logger";
import type { ISandboxProvider, SandboxInstance, SandboxProviderConfig } from "./types";

const log = createLogger("sandbox-mgr");

export interface SandboxManagerConfig {
  /** 空闲超时毫秒 */
  idleTimeoutMs: number;
  /** 回收检查间隔 */
  gcIntervalMs: number;
  /** 传递给 provider 的配置 */
  providerConfig: SandboxProviderConfig;
}

export class SandboxManager {
  private provider: ISandboxProvider;
  private instances = new Map<string, SandboxInstance>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private config: SandboxManagerConfig;

  constructor(provider: ISandboxProvider, config: SandboxManagerConfig) {
    this.provider = provider;
    this.config = config;
    this.startGcLoop();
  }

  /** 获取用户的沙箱，没有则创建 */
  async getOrCreate(userId: string): Promise<SandboxInstance> {
    const existing = this.instances.get(userId);
    if (existing && existing.status === "running") {
      existing.lastActiveAt = Date.now();
      this.provider.keepAlive(userId);
      return existing;
    }

    const instance = await this.provider.getOrCreate(userId, this.config.providerConfig);
    this.instances.set(userId, instance);
    return instance;
  }

  /** 保活 */
  keepAlive(userId: string): void {
    const sb = this.instances.get(userId);
    if (sb) {
      sb.lastActiveAt = Date.now();
      this.provider.keepAlive(userId);
    }
  }

  /** 销毁沙盒 */
  async destroy(userId: string): Promise<void> {
    log.info("Destroying sandbox", { userId });
    await this.provider.destroy(userId);
    this.instances.delete(userId);
  }

  /** 获取总数 */
  getActiveCount(): number {
    return this.instances.size;
  }

  /** 获取所有沙箱信息 */
  getAll(): SandboxInstance[] {
    return Array.from(this.instances.values());
  }

  /** 停止所有 */
  stop(): void {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.provider.shutdown().catch((err) => {
      log.warn("Provider shutdown failed", { error: String(err) });
    });
    this.instances.clear();
  }

  private startGcLoop(): void {
    this.gcTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, sb] of this.instances) {
        if (now - sb.lastActiveAt > this.config.idleTimeoutMs) {
          log.info("GC: recycling idle sandbox", { userId, idleMs: now - sb.lastActiveAt });
          this.destroy(userId).catch((err) => {
            log.warn("GC destroy failed", { userId, error: String(err) });
          });
        }
      }
    }, this.config.gcIntervalMs);
  }
}
