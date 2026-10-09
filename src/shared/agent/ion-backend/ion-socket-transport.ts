/**
 * ion Unix socket 传输层。
 *
 * 协议硬约束（contract-matrix.md §2/§4，实测）：
 *  - JSONL over AF_UNIX；
 *  - 每条连接只处理一行命令 —— RPC 用独立短连接（一问一答即关）；
 *  - 响应按 id 分拣（host 会回显客户端 id）；
 *  - soft-error：success:true + data.error 必须当失败抛出。
 */

import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../../lib/logger";

const log = createLogger("ion-transport");

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const HOST_READY_TIMEOUT_MS = 20_000;

export interface IonCallOptions {
  timeoutMs?: number;
  /** 保留 data.error 不抛（个别方法把 error 当业务数据返回） */
  allowSoftError?: boolean;
}

export function resolveIonSocketPath(): string {
  return process.env.ION_HOST_SOCKET ?? join(homedir(), ".ion", "host.sock");
}

function resolveIonBinary(): string {
  return process.env.ION_BIN ?? "ion";
}

/** 单次短连接 RPC：连接 → 发一行 → 按 id 收一行响应 → 关闭 */
function rpcOnce(
  socketPath: string,
  request: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const id = request.id as string;
  const method = String(request.method);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    const lines: string[] = [];
    let settled = false;

    const finish = (err: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value as Record<string, unknown>);
    };

    const timer = setTimeout(() => {
      finish(new Error(`ion RPC ${method} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) lines.push(line);
        for (const candidate of lines.splice(0)) {
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(candidate) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (parsed.id === id) {
            finish(null, parsed);
            return;
          }
        }
      }
    });
    socket.on("error", (err: Error) => finish(err));
    socket.on("close", () => {
      if (!settled) finish(new Error(`ion RPC ${method}: connection closed before response`));
    });
  });
}

export class IonSocketTransport {
  private callSeq = 0;
  private hostProcess: ChildProcess | null = null;

  constructor(private socketPath: string = resolveIonSocketPath()) {}

  get path(): string {
    return this.socketPath;
  }

  isHostReachable(timeoutMs = 1500): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(this.socketPath);
      const done = (ok: boolean) => {
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs, () => done(false));
      socket.on("connect", () => done(true));
      socket.on("error", () => done(false));
    });
  }

  /**
   * 确保 host 在跑：socket 可达直接复用（绝不碰已存在的 host）；
   * 不可达时 spawn `ion serve`（ION_BIN 可覆盖二进制路径）。
   */
  async ensureHost(autoSpawn = true): Promise<void> {
    if (await this.isHostReachable()) return;
    if (!autoSpawn) {
      throw new Error(
        `ion host unreachable at ${this.socketPath} (set ION_HOST_SOCKET or start \`ion serve\`)`,
      );
    }
    const bin = resolveIonBinary();
    log.info("spawning ion host", { bin, socket: this.socketPath });
    const child = spawn(bin, ["serve"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    this.hostProcess = child;
    const deadline = Date.now() + HOST_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.isHostReachable()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      `ion host failed to become ready at ${this.socketPath} within ${HOST_READY_TIMEOUT_MS}ms`,
    );
  }

  stop(): void {
    // 只处理我们自己 spawn 的 host；外部已存在的 host 绝不 kill
    if (this.hostProcess && this.hostProcess.pid) {
      try {
        this.hostProcess.kill("SIGTERM");
      } catch {
        // 进程可能已退出
      }
    }
    this.hostProcess = null;
  }

  /** manager 级命令（无 session） */
  async managerCall<T = unknown>(
    method: string,
    params?: unknown,
    options?: IonCallOptions,
  ): Promise<T> {
    return (await this.call(method, params, options)) as T;
  }

  /** 实例级命令（session 是请求顶层字段，与 method/params 平级 —— 实测协议） */
  async sessionCall<T = unknown>(
    sessionId: string,
    method: string,
    params?: unknown,
    options?: IonCallOptions,
  ): Promise<T> {
    return (await this.call(method, params, options, sessionId)) as T;
  }

  private async call(
    method: string,
    params: unknown,
    options?: IonCallOptions,
    sessionId?: string,
  ): Promise<unknown> {
    const id = `pi-chat-${++this.callSeq}`;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const request: Record<string, unknown> = { id, method, params: params ?? {} };
    if (sessionId) request.session = sessionId;
    const response = await rpcOnce(this.socketPath, request, timeoutMs);

    if (response.success === false) {
      const message =
        typeof response.error === "string" ? response.error : `ion RPC ${method} failed`;
      throw new Error(message);
    }
    const data = response.data as Record<string, unknown> | undefined;
    if (
      !options?.allowSoftError &&
      data &&
      typeof data.error === "string" &&
      data.error.length > 0 &&
      method !== "prompt" // prompt 对无效 session 的软错误由上层判断重试
    ) {
      throw new Error(`ion RPC ${method}: ${data.error}`);
    }
    return response.data;
  }
}

/** 便捷函数：一次性 RPC（探测/测试用） */
export async function ionQuickCall<T = unknown>(
  method: string,
  params?: unknown,
  socketPath = resolveIonSocketPath(),
): Promise<T> {
  return (await rpcOnce(
    socketPath,
    { id: "pi-chat-probe", method, params: params ?? {} },
    DEFAULT_CONNECT_TIMEOUT_MS,
  ).then((r) => {
    if (r.success === false)
      throw new Error(typeof r.error === "string" ? r.error : `ion RPC ${method} failed`);
    return r.data;
  })) as T;
}

export { existsSync };
