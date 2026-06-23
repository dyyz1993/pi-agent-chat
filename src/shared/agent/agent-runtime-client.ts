import { existsSync, mkdirSync } from "fs";
import { relative, resolve, sep } from "path";
import { performance } from "perf_hooks";

import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { SandboxManager } from "../../sandbox/sandbox-manager";
import { SandboxBoxProvider } from "../../sandbox/providers/sandbox-box";
import { RemoteSshProvider } from "../../sandbox/providers/ssh";
import { bootstrapRemoteChild } from "../../sandbox/remote-child-bootstrap";
import { SandboxRpcClient } from "../../sandbox/sandbox-rpc-client";
import type { ISandboxProvider } from "../../sandbox/types";
import { config } from "../../server-config";
import { createLogger } from "../lib/logger";
import { discoverExtensionArgs, getBuiltinExtensionsDir, scanExtensionDir } from "./agent-runtime-config";
import {
  applyExecutionSandboxEnv,
  readProjectExecutionSandbox,
} from "../lib/execution-sandbox-config";

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

function getRemoteExtensionArgs(
  localExtensionsDir: string | undefined,
  remoteExtensionsDir: string | undefined,
): string[] {
  if (!localExtensionsDir || !remoteExtensionsDir || !existsSync(localExtensionsDir)) {
    return ["--no-extensions"];
  }

  const localExtensionPaths: string[] = [];
  scanExtensionDir(localExtensionsDir, localExtensionPaths);
  return [
    "--no-extensions",
    ...localExtensionPaths.flatMap((localExtensionPath) => {
      const relativePath = relative(localExtensionsDir, localExtensionPath);
      return ["--extension", `${remoteExtensionsDir}/${relativePath.split(sep).join("/")}`];
    }),
  ];
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
  } else if (providerType === "ssh") {
    provider = new RemoteSshProvider({
      target: config.remoteSshTarget,
      port: config.remoteSshPort,
      keyPath: config.remoteSshKey || undefined,
      localBasePort: config.remoteLocalBasePort,
      remoteBridgePort: config.remoteBridgePort,
      remoteProjectPath: config.remoteProjectPath,
      remoteAgentDir: config.remoteAgentDir,
      remotePiCliPath: config.remotePiCliPath,
      remoteNodePath: config.remoteNodePath,
      remoteShell: config.remoteShell,
      remotePiAgentDir: config.remotePiAgentDir || undefined,
      childNodeOptions: config.remoteChildNodeOptions,
      bootstrapPiPackage: config.remoteBootstrapPiPackage,
      localPiPackagePath: resolve(config.remoteLocalPiPackagePath),
      localWorkspacePackagesPath: config.remoteLocalPiWorkspacePackagesPath
        ? resolve(config.remoteLocalPiWorkspacePackagesPath)
        : undefined,
    });
  } else {
    throw new Error(
      `Unknown sandbox provider: ${providerType}. Supported providers: "sandbox-box", "ssh".`,
    );
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
  const useRemoteChild = config.remoteChildEnabled;
  if (useRemoteChild && (!config.remoteSshTarget || !config.remoteChildProjectPath)) {
    throw new Error(
      "REMOTE_CHILD_ENABLED requires REMOTE_SSH_TARGET and REMOTE_CHILD_PROJECT_PATH or REMOTE_PROJECT_PATH",
    );
  }

  if (!useRemoteChild && config.sandboxEnabled && globalSandboxManager && userId) {
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

  const localRemoteChildExtensionsDir =
    config.remoteChildLocalExtensionsDir || (useRemoteChild ? getBuiltinExtensionsDir() : "");
  const remoteChildBootstrap =
    useRemoteChild && config.remoteChildAutoUpload && config.remoteChildLocalBinaryPath
      ? await bootstrapRemoteChild({
          target: config.remoteSshTarget,
          port: config.remoteSshPort,
          keyPath: config.remoteSshKey || undefined,
          remoteShell: config.remoteChildShell,
          remoteRuntimeDir: config.remoteChildRemoteRuntimeDir,
          localBinaryPath: config.remoteChildLocalBinaryPath,
          localExtensionsDir: localRemoteChildExtensionsDir,
          binaryName: config.remoteChildBinaryName,
        })
      : undefined;
  const remoteChildCliPath = remoteChildBootstrap?.remoteBinaryPath ?? config.remoteChildPiCliPath;
  const remoteChildNodePath = remoteChildBootstrap ? "" : config.remoteChildNodePath;
  const args = buildRpcClientArgs({
    extensionArgs: useRemoteChild
      ? getRemoteExtensionArgs(localRemoteChildExtensionsDir, remoteChildBootstrap?.remoteExtensionsDir)
      : EXTENSION_ARGS,
    sessionPath: useRemoteChild ? undefined : sessionPath,
    sessionExists: Boolean(!useRemoteChild && sessionPath && existsSync(sessionPath)),
  });

  const client = new cachedModule.RpcClient({
    cliPath: useRemoteChild ? remoteChildCliPath : cliPath,
    cwd,
    args,
    env: {
      ...applyExecutionSandboxEnv(process.env, readProjectExecutionSandbox(cwd).mode),
      NODE_OPTIONS: "--max-old-space-size=4096",
    },
    ...(useRemoteChild
      ? {
          remoteSsh: {
            target: config.remoteSshTarget,
            cwd: config.remoteChildProjectPath,
            sshArgs: [
              "-o",
              "BatchMode=yes",
              "-o",
              "ConnectTimeout=8",
              ...(config.remoteSshPort ? ["-p", String(config.remoteSshPort)] : []),
              ...(config.remoteSshKey ? ["-i", config.remoteSshKey] : []),
            ],
            nodePath: remoteChildNodePath,
            shell: config.remoteChildShell,
            env: {
              ...(config.remotePiAgentDir ? { PI_CODING_AGENT_DIR: config.remotePiAgentDir } : {}),
              NODE_OPTIONS: config.remoteChildNodeOptions,
            },
          },
        }
      : {}),
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
