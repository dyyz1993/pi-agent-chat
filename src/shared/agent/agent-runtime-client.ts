import { existsSync, mkdirSync } from "fs";
import { performance } from "perf_hooks";

import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { SandboxManager } from "../../sandbox/sandbox-manager";
import { SandboxBoxProvider } from "../../sandbox/providers/sandbox-box";
import { SandboxRpcClient } from "../../sandbox/sandbox-rpc-client";
import type { ISandboxProvider } from "../../sandbox/types";
import { config } from "../../server-config";
import { createLogger } from "../lib/logger";
import { discoverExtensionArgs } from "./agent-runtime-config";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

const EXTENSION_ARGS = ["--no-extensions", ...discoverExtensionArgs()];

type RpcClientInstance = RpcClientAPI;

let cachedModule: { RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI } | null =
  null;

let globalSandboxManager: SandboxManager | null = null;

export function buildRpcClientArgs(options: {
  extensionArgs: string[];
  sessionPath: string | undefined;
  sessionExists: boolean;
}): string[] {
  const args = [...options.extensionArgs];
  if (options.sessionPath && options.sessionExists) {
    args.push("--session", options.sessionPath);
  }
  return args;
}

export function initSandboxManager(projectsRoot: string): SandboxManager {
  let provider: ISandboxProvider;
  const providerType = config.sandboxProvider ?? "local";

  if (providerType === "sandbox-box") {
    provider = new SandboxBoxProvider({
      sshHost: config.sandboxBoxSshHost ?? "192.168.0.29",
      sshPort: config.sandboxBoxSshPort ?? 2201,
      sshUser: config.sandboxBoxSshUser ?? "root",
      sshKeyPath: config.sandboxBoxSshKey ?? "~/.ssh/id_rsa",
      sandboxPort: 3200,
      bridgePort: 3101,
      baseLocalPort: config.sandboxBasePort,
      piCliPath: config.piCliPath,
      projectSourcePath: projectsRoot,
      modelsJsonPath: config.sandboxBoxModelsJson,
      settingsJsonPath: config.sandboxBoxSettingsJson,
      extensionsPath: config.sandboxBoxExtensionsPath,
    });
  } else {
    throw new Error(`Unknown sandbox provider: ${providerType}. Only "sandbox-box" is supported.`);
  }

  globalSandboxManager = new SandboxManager(provider, {
    idleTimeoutMs: (config.sandboxIdleTimeout ?? 1800) * 1000,
    gcIntervalMs: 60_000,
    providerConfig: {
      idleTimeout: `${config.sandboxIdleTimeout ?? 1800}s`,
      enableInternet: true,
    },
  });

  if (providerType === "sandbox-box" && provider instanceof SandboxBoxProvider) {
    provider.cleanupStaleSandboxes([]).catch((err: unknown) => {
      log.warn("startup sandbox cleanup failed (non-fatal)", { error: String(err) });
    });
  }

  return globalSandboxManager;
}

export function getSandboxEndpoint(userId: string): string | null {
  if (!globalSandboxManager) return null;
  return globalSandboxManager.getEndpoint(userId) ?? null;
}

export function getSandboxManager(): SandboxManager | null {
  return globalSandboxManager;
}

export async function createRpcClient(
  cliPath: string,
  cwd: string,
  sessionPath: string | undefined,
  userId?: string,
): Promise<{ client: RpcClientInstance; timings: { dynamicImport: number; construct: number } }> {
  const t0 = performance.now();

  if (config.sandboxEnabled && globalSandboxManager && userId) {
    const sandbox = await globalSandboxManager.getOrCreate(userId);
    const client = new SandboxRpcClient(sandbox.endpoint) as unknown as RpcClientInstance;
    const t1 = performance.now();
    const timings = { dynamicImport: Math.round(t1 - t0), construct: 0 };
    perfLog.info("[createRpcClient] sandbox mode", { userId, endpoint: sandbox.endpoint });
    return { client, timings };
  }

  cachedModule ??= (await import("@dyyz1993/pi-coding-agent")) as unknown as {
    RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI;
  };
  const t1 = performance.now();

  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

  const args = buildRpcClientArgs({
    extensionArgs: EXTENSION_ARGS,
    sessionPath,
    sessionExists: Boolean(sessionPath && existsSync(sessionPath)),
  });

  const client = new cachedModule.RpcClient({
    cliPath,
    cwd,
    args,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
  });
  const tBeforeStart = performance.now();
  perfLog.info("[createRpcClient] calling client.start()", { sessionId: sessionPath?.split("/").pop(), cwd, argsCount: args.length });
  try {
    await client.start();
  } catch (startErr) {
    const startMs = Math.round(performance.now() - tBeforeStart);
    perfLog.error("[createRpcClient] client.start() FAILED", {
      startMs,
      err: startErr instanceof Error ? startErr.message.split("\n")[0] : String(startErr),
    });
    throw startErr;
  }
  const startMs = Math.round(performance.now() - tBeforeStart);
  perfLog.info("[createRpcClient] client.start() succeeded", { startMs });
  const t2 = performance.now();

  const timings = {
    dynamicImport: Math.round(t1 - t0),
    construct: Math.round(t2 - t1),
    start: Math.round(t2 - t1),
  };
  perfLog.info("[createRpcClient] done", timings);

  return { client, timings };
}
