import { existsSync, mkdirSync } from "fs";
import { relative, resolve, sep } from "path";
import { performance } from "perf_hooks";

import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { SandboxManager } from "../../sandbox/sandbox-manager";
import { SandboxBoxProvider } from "../../sandbox/providers/sandbox-box";
import { RemoteSshProvider } from "../../sandbox/providers/ssh";
import {
  bootstrapRemoteChild,
  resolveRemoteChildLocalBinaryPath,
} from "../../sandbox/remote-child-bootstrap";
import { syncRemoteAgentResources } from "../../sandbox/remote-resource-sync";
import { SandboxRpcClient } from "../../sandbox/sandbox-rpc-client";
import type { ISandboxProvider } from "../../sandbox/types";
import { config } from "../../server-config";
import { createLogger } from "../lib/logger";
import {
  discoverExtensionArgs,
  getBuiltinExtensionsDir,
  scanExtensionDir,
} from "./agent-runtime-config";
import {
  applyExecutionSandboxEnv,
  readProjectExecutionSandbox,
} from "../lib/execution-sandbox-config";
import { buildRemoteAgentChildRuntimeEnv, buildSshCommandRuntimeEnv } from "./runtime-resource-env";
import {
  buildRemoteChildSshArgs,
  resolveActiveRuntimeSelection,
  shouldCreateLocalRuntimeCwd,
} from "./remote-runtime-selection";
import { attachRemoteSessionMirror, getRemoteChildSessionDir } from "./remote-session-mirror";
import { startModelProxy, type StartedModelProxy } from "./model-proxy";
import {
  getRemoteProjectTrustArgs,
  resolveRemoteResourceSyncPlan,
  toRemoteResourceSyncOptions,
} from "./remote-resource-sync-policy";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

const EXTENSION_ARGS = ["--no-extensions", ...discoverExtensionArgs()];
const BUILTIN_EXTENSION_ARGS = [
  "--no-extensions",
  ...discoverExtensionArgs({ includeUser: false }),
];

type RpcClientInstance = RpcClientAPI;

let cachedModule: { RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI } | null =
  null;

let globalSandboxManager: SandboxManager | null = null;

export function buildRpcClientArgs(options: {
  extensionArgs: string[];
  sessionId?: string;
  sessionDir?: string;
  sessionPath: string | undefined;
  sessionExists: boolean;
}): string[] {
  const args = [...options.extensionArgs];
  if (options.sessionDir) {
    args.push("--session-dir", options.sessionDir);
  }
  if (options.sessionId) {
    args.push("--session-id", options.sessionId);
    return args;
  }
  if (options.sessionPath && options.sessionExists) {
    args.push("--session", options.sessionPath);
  }
  return args;
}

export function getSessionIdFromSessionPath(sessionPath: string | undefined): string | undefined {
  if (!sessionPath) return undefined;
  const fileName = sessionPath.split(/[\\/]/).pop();
  if (!fileName) return undefined;
  return fileName.endsWith(".jsonl") ? fileName.slice(0, -".jsonl".length) : fileName;
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
  const runtime = await resolveActiveRuntimeSelection(cwd);
  const useRemoteChild = runtime.kind === "remote-agent-child";
  const remoteChildRuntime = runtime.kind === "remote-agent-child" ? runtime : undefined;

  if (runtime.kind === "local" && config.sandboxEnabled && globalSandboxManager && userId) {
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

  if (shouldCreateLocalRuntimeCwd(runtime) && !existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

  const localRemoteChildExtensionsDir =
    config.remoteChildLocalExtensionsDir || (useRemoteChild ? getBuiltinExtensionsDir() : "");
  const localRemoteChildBinaryPath =
    useRemoteChild && config.remoteChildAutoUpload
      ? await resolveRemoteChildLocalBinaryPath({
          explicitPath: config.remoteChildLocalBinaryPath || undefined,
          cliPath: config.piCliPath,
          target: runtime.target,
          port: runtime.port,
          keyPath: runtime.keyPath,
          remoteShell: runtime.shell,
        })
      : "";
  if (useRemoteChild && config.remoteChildAutoUpload && !localRemoteChildBinaryPath) {
    throw new Error(
      "Standard SSH requires a local remote-child binary. Set REMOTE_CHILD_LOCAL_BINARY_PATH or build a matching dist/pi-<platform>-<arch> binary.",
    );
  }
  const remoteChildBootstrap =
    useRemoteChild && config.remoteChildAutoUpload && localRemoteChildBinaryPath
      ? await bootstrapRemoteChild({
          target: runtime.target,
          port: runtime.port,
          keyPath: runtime.keyPath,
          remoteShell: runtime.shell,
          remoteRuntimeDir: config.remoteChildRemoteRuntimeDir,
          localBinaryPath: localRemoteChildBinaryPath,
          localExtensionsDir: localRemoteChildExtensionsDir,
          binaryName: config.remoteChildBinaryName,
        })
      : undefined;
  const remoteChildCliPath = remoteChildBootstrap?.remoteBinaryPath ?? config.remoteChildPiCliPath;
  const remoteChildNodePath = remoteChildBootstrap ? "" : config.remoteChildNodePath;
  const remoteResourceSyncPlan =
    useRemoteChild && remoteChildRuntime
      ? resolveRemoteResourceSyncPlan({ runtime: remoteChildRuntime, cwd })
      : null;
  const remoteResourceSync =
    remoteResourceSyncPlan && remoteChildRuntime
      ? await syncRemoteAgentResources(
          toRemoteResourceSyncOptions(remoteResourceSyncPlan, remoteChildRuntime),
        ).catch((err: unknown) => {
          log.warn("[createRpcClient] optional remote resource sync failed; continuing", {
            cwd,
            err: err instanceof Error ? err.message : String(err),
          });
          return undefined;
        })
      : undefined;
  const runtimeRemotePiAgentDir = useRemoteChild ? runtime.remotePiAgentDir : undefined;
  const remotePiAgentDir = remoteResourceSync?.remoteAgentDir ?? runtimeRemotePiAgentDir;
  const modelProxy = useRemoteChild ? await startModelProxy() : undefined;
  const remoteSessionDir =
    useRemoteChild && remotePiAgentDir
      ? getRemoteChildSessionDir({ remotePiAgentDir, remoteCwd: runtime.remoteCwd })
      : undefined;
  const remoteSessionId = useRemoteChild ? getSessionIdFromSessionPath(sessionPath) : undefined;
  const args = buildRpcClientArgs({
    extensionArgs: useRemoteChild
      ? [
          ...getRemoteExtensionArgs(
            localRemoteChildExtensionsDir,
            remoteChildBootstrap?.remoteExtensionsDir,
          ),
          ...getRemoteProjectTrustArgs({ runtime, cwd }),
        ]
      : runtime.kind === "ssh-command"
        ? BUILTIN_EXTENSION_ARGS
        : EXTENSION_ARGS,
    sessionId: remoteSessionId,
    sessionDir: remoteSessionDir,
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
      ...(runtime.kind === "ssh-command" ? buildSshCommandRuntimeEnv(runtime.remoteProject) : {}),
    },
    ...(useRemoteChild
      ? {
          remoteSsh: {
            target: runtime.target,
            cwd: runtime.remoteCwd,
            sshArgs: [...(modelProxy?.sshArgs ?? []), ...buildRemoteChildSshArgs(runtime)],
            nodePath: remoteChildNodePath,
            shell: runtime.shell,
            env: buildRemoteAgentChildRuntimeEnv({
              remotePiAgentDir,
              nodeOptions: config.remoteChildNodeOptions,
              modelProxyEnv: modelProxy?.env,
            }),
          },
        }
      : {}),
  });
  attachModelProxyCleanup(client, modelProxy);
  const tBeforeStart = performance.now();
  perfLog.info("[createRpcClient] calling client.start()", {
    sessionId: sessionPath?.split("/").pop(),
    cwd,
    argsCount: args.length,
  });
  try {
    await client.start();
  } catch (startErr) {
    await modelProxy?.stop().catch(() => {});
    const startMs = Math.round(performance.now() - tBeforeStart);
    perfLog.error("[createRpcClient] client.start() FAILED", {
      startMs,
      err: startErr instanceof Error ? startErr.message.split("\n")[0] : String(startErr),
    });
    throw startErr;
  }
  const startMs = Math.round(performance.now() - tBeforeStart);
  perfLog.info("[createRpcClient] client.start() succeeded", { startMs });
  if (useRemoteChild) {
    attachRemoteSessionMirror({
      client,
      runtime,
      sessionId: remoteSessionId,
      localProjectPath: cwd,
      localSessionPath: sessionPath,
    });
  }
  const t2 = performance.now();

  const timings = {
    dynamicImport: Math.round(t1 - t0),
    construct: Math.round(t2 - t1),
    start: Math.round(t2 - t1),
  };
  perfLog.info("[createRpcClient] done", timings);

  return { client, timings };
}

function attachModelProxyCleanup(
  client: RpcClientInstance,
  modelProxy: StartedModelProxy | undefined,
): void {
  if (!modelProxy) return;
  const originalStop = client.stop.bind(client);
  let stopped = false;
  client.stop = async (...args: Parameters<RpcClientInstance["stop"]>) => {
    try {
      return await originalStop(...args);
    } finally {
      if (!stopped) {
        stopped = true;
        await modelProxy.stop().catch((err: unknown) => {
          log.warn("model proxy cleanup failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  };
}
