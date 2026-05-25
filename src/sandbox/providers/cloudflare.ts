/**
 * CloudflareSandboxProvider — Cloudflare Containers 沙盒（上云用）
 *
 * 使用 @cloudflare/containers 的 Container + getContainer API。
 * 每个 userId 对应一个 Durable Object 容器实例。
 *
 * 注意：此文件仅在 Cloudflare Workers 环境中使用。
 * 本地开发/自建部署时不导入此模块。
 */

import { createLogger } from "../../shared/lib/logger";
import type { ISandboxProvider, SandboxInstance, SandboxProviderConfig } from "../types";

const log = createLogger("sandbox-cf");

interface CfContainerBinding {
  getByName(name: string): {
    fetch(request: Request): Promise<Response>;
    destroy(): Promise<void>;
    getState(): Promise<{ status: string }>;
  };
}

export interface CloudflareProviderOptions {
  /** Durable Object binding name */
  binding: CfContainerBinding;
}

export class CloudflareSandboxProvider implements ISandboxProvider {
  private cache = new Map<string, SandboxInstance>();
  private options: CloudflareProviderOptions;

  constructor(options: CloudflareProviderOptions) {
    this.options = options;
  }

  async getOrCreate(userId: string, _config: SandboxProviderConfig): Promise<SandboxInstance> {
    const cached = this.cache.get(userId);
    if (cached && cached.status === "running") {
      cached.lastActiveAt = Date.now();
      return cached;
    }

    log.info("Getting Cloudflare container", { userId });
    const container = this.options.binding.getByName(userId);

    const state = await container.getState();
    const instance: SandboxInstance = {
      userId,
      status: state.status === "healthy" ? "running" : "creating",
      endpoint: `cf-container://${userId}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.cache.set(userId, instance);
    return instance;
  }

  async destroy(userId: string): Promise<void> {
    log.info("Destroying Cloudflare container", { userId });
    const container = this.options.binding.getByName(userId);
    await container.destroy();
    this.cache.delete(userId);
  }

  async getStatus(userId: string): Promise<SandboxInstance | null> {
    try {
      const container = this.options.binding.getByName(userId);
      const state = await container.getState();
      const cached = this.cache.get(userId);
      if (cached) {
        cached.status = state.status === "healthy" ? "running" : "stopped";
        return cached;
      }
      return null;
    } catch {
      return null;
    }
  }

  keepAlive(userId: string): void {
    const sb = this.cache.get(userId);
    if (sb) sb.lastActiveAt = Date.now();
  }

  async shutdown(): Promise<void> {
    for (const userId of this.cache.keys()) {
      await this.destroy(userId);
    }
  }

  /** Cloudflare 特有：透传请求到容器 */
  async fetch(userId: string, request: Request): Promise<Response> {
    const container = this.options.binding.getByName(userId);
    return container.fetch(request);
  }
}
