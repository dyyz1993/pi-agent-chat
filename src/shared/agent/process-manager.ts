import { existsSync, mkdirSync, readFileSync, realpathSync } from "fs";

import * as path from "path";
import type { RPCServer } from "@dyyz1993/rpc-core";
import type {
  AgentEvent,
  AgentMessageForUI,
  ExtensionUIRequestEvent,
  RemoteSshStatus,
} from "../modules/agent";
import type { AssistantMessage, AssistantMessageEvent, ImageContent } from "@dyyz1993/pi-ai";
import type { RpcClientAPI, ChannelTypeRegistry } from "@dyyz1993/pi-coding-agent";
import type { TreeEntry } from "../modules/agent";
import { performance } from "perf_hooks";
import { SessionMessageReader } from "./session-message-reader";
import { AgentEventHandler } from "./event-handler";
import type { AgentEventHandlerDeps } from "./event-handler";
import { CoordinatorHandler } from "./coordinator-handler";
import {
  BUILTIN_INTERNAL_EXTENSION_NAMES,
  filterDisabledExtensionPaths,
  parseTierModel,
  scanExtensionDir,
  TIER_KEYS,
  type TierKey,
} from "./agent-runtime-config";
import { registerAgentChannels } from "./agent-channel-registration";
import {
  getAvailableModelsOperation,
  setModelOperation,
  switchTierOperation,
  cycleModelOperation,
  setThinkingLevelOperation,
  cycleThinkingLevelOperation,
} from "./agent-client-model-operations";
import {
  getTierModelsOperation,
  setTierModelsOperation,
  getAgentsOperation,
  switchAgentOperation,
  getCurrentAgentOperation,
  getLatestAgentChangeOperation,
} from "./agent-client-command-operations";
import {
  getLastAssistantTextOperation,
  getForkMessagesOperation,
  forkOperation,
  previewRollbackOperation,
  getModifiedFilesOperation,
  getFileDiffOperation,
  getBatchDiffsOperation,
  restoreFilesFromSnapshotOperation,
  cloneOperation,
  newSessionOperation,
  exportHtmlOperation,
} from "./agent-client-history-operations";
import {
  getFullMessagesAroundOperation,
  getMessageNavPageOperation,
} from "./agent-client-message-operations";
import {
  compactOperation,
  setAutoCompactionOperation,
  setAutoRetryOperation,
  abortRetryOperation,
  setSteeringModeOperation,
  setFollowUpModeOperation,
  setPermissionModeOperation,
  getActiveToolsOperation,
  setActiveToolsOperation,
  getQueueOperation,
  clearQueueOperation,
  promoteQueuedFollowUpOperation,
  getExtensionsOperation,
  getSkillsOperation,
  reloadOperation,
  getToolsOperation,
  getMcpServersOperation,
  toggleMcpServerOperation,
  restartMcpServerOperation,
  getContextUsageOperation,
} from "./agent-client-session-operations";
import {
  abortOperation,
  sendPromptOperation,
  steerOperation,
  followUpOperation,
} from "./agent-client-lifecycle-operations";
import { getCommandsOperation } from "./agent-client-state-operations";
import { startAgentClientOperation } from "./agent-start-operations";
import { stopAgentClientOperation } from "./agent-stop-operations";
import { buildRemoteAgentChildRuntimeEnv, buildSshCommandRuntimeEnv } from "./runtime-resource-env";
import {
  type ActiveRuntimeSelection,
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

// 沙箱模式
import { SandboxManager } from "../../sandbox/sandbox-manager";
import { SandboxBoxProvider } from "../../sandbox/providers/sandbox-box";
import { RemoteSshProvider } from "../../sandbox/providers/ssh";
import {
  bootstrapRemoteChild,
  resolveRemoteChildLocalBinaryPath,
} from "../../sandbox/remote-child-bootstrap";
import { syncRemoteAgentResources } from "../../sandbox/remote-resource-sync";
import type { ISandboxProvider } from "../../sandbox/types";
import { SandboxRpcClient } from "../../sandbox/sandbox-rpc-client";

type McpServerInfo = Awaited<ReturnType<RpcClientInstance["getMcpServers"]>>[number];

type ChannelMethodKeys<CN extends keyof ChannelTypeRegistry> = keyof NonNullable<
  ChannelTypeRegistry[CN]["methods"]
> &
  string;

type ChannelMethodParams<
  CN extends keyof ChannelTypeRegistry,
  MN extends ChannelMethodKeys<CN>,
> = NonNullable<ChannelTypeRegistry[CN]["methods"]>[MN] extends { params: infer P } ? P : unknown;

type ChannelMethodReturn<
  CN extends keyof ChannelTypeRegistry,
  MN extends ChannelMethodKeys<CN>,
> = NonNullable<ChannelTypeRegistry[CN]["methods"]>[MN] extends { return: infer R } ? R : unknown;
import type { CoordinatorMethodCall } from "../modules/coordinator";
import { createLogger } from "../lib/logger";
import { config } from "../../server-config";
import {
  applyExecutionSandboxEnv,
  readProjectExecutionSandbox,
} from "../lib/execution-sandbox-config";
import {
  makeProcessPoolKey,
  addToProcessPool,
  removeFromProcessPool,
  selectLruEvictionCandidate,
  countProcessPoolEntries,
} from "./agent-process-pool";
import { ensureManagedClientOperation } from "./agent-managed-client-operations";
import { findSessionById } from "../lib/session-scanner";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");
const TIER_KEY_SET = new Set<string>(TIER_KEYS);

function isTierKey(value: string): value is TierKey {
  return TIER_KEY_SET.has(value);
}

function parseExplicitModelName(model: string): { provider: string; modelId: string } {
  const [provider, ...modelParts] = model.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    throw new Error(
      `Invalid model "${model}". Expected format: provider/modelId or tier alias (${TIER_KEYS.join(
        "/",
      )})`,
    );
  }
  return { provider, modelId };
}

function readPersistedSessionAgent(sessionPath: string): string | null {
  if (!sessionPath || !existsSync(sessionPath)) return null;
  try {
    const lines = readFileSync(sessionPath, "utf-8").split("\n").slice(0, 20);
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (
        (entry.type === "session" || entry.type === "delegate_info") &&
        typeof entry.agent === "string" &&
        entry.agent.trim()
      ) {
        return entry.agent;
      }
    }
  } catch (err: unknown) {
    log.debug("failed to read persisted session agent", {
      sessionPath,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error if the
 * promise does not settle within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

function getBuiltinExtensionsDir(): string | undefined {
  const cliPath = config.piCliPath;
  // Resolve symlinks — .bin/pi is a symlink to ../@dyyz1993/pi-coding-agent/dist/cli.js
  // Without realpathSync, path.resolve would go up from .bin/ instead of dist/
  let resolvedCliPath: string;
  try {
    resolvedCliPath = realpathSync(cliPath);
  } catch (err: unknown) {
    log.warn("Failed to resolve builtin extension CLI path", {
      cliPath,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
  // cli.js is at <pkg>/dist/cli.js — go up 2 levels to reach package root
  const pkgRoot = path.resolve(resolvedCliPath, "..", "..");

  // Priority 1: yalc / node_modules layout — <root>/node_modules/@dyyz1993/pi-coding-agent/dist/cli.js
  const nmPkgDir = path.join(path.resolve(pkgRoot, "..", ".."), "@dyyz1993", "pi-coding-agent");
  if (existsSync(path.join(nmPkgDir, "dist", "extensions"))) {
    return path.join(nmPkgDir, "dist", "extensions");
  }
  if (existsSync(path.join(nmPkgDir, "src", "extensions"))) {
    return path.join(nmPkgDir, "src", "extensions");
  }

  // Priority 2: fork source layout — <pkg>/dist/cli.js with extensions at <pkg>/extensions/
  const forkExtDir = path.join(pkgRoot, "extensions");
  if (existsSync(forkExtDir)) {
    return forkExtDir;
  }

  // Priority 3: standard layout — <pkg>/dist/extensions or <pkg>/src/extensions
  const srcExists = existsSync(path.join(pkgRoot, "src"));
  return path.join(pkgRoot, srcExists ? "src" : "dist", "extensions");
}

function discoverExtensionArgs(includeUser = true): string[] {
  const extensionPaths: string[] = [];

  const userExtDir = config.piExtensionsDir;
  if (includeUser && existsSync(userExtDir)) {
    scanExtensionDir(userExtDir, extensionPaths);
  } else if (includeUser) {
    log.warn("Global extensions directory not found", { extDir: userExtDir });
  }

  const builtinExtDir = getBuiltinExtensionsDir();
  if (builtinExtDir && existsSync(builtinExtDir)) {
    scanExtensionDir(builtinExtDir, extensionPaths, {
      allowPrivateEntries: BUILTIN_INTERNAL_EXTENSION_NAMES,
    });
  }

  const filteredExtensionPaths = filterDisabledExtensionPaths(extensionPaths);

  log.info("Discovered extensions", {
    userDir: userExtDir,
    builtinDir: builtinExtDir,
    count: filteredExtensionPaths.length,
    filteredCount: extensionPaths.length - filteredExtensionPaths.length,
  });
  for (const p of filteredExtensionPaths) {
    log.info("  → extension:", { path: p });
  }
  return filteredExtensionPaths.flatMap((p) => ["--extension", p]);
}

// Lazy-init: discoverExtensionArgs() hits the filesystem (realpathSync on
// piCliPath) and must NOT run at module load time. Earlier this was a top-level
// const, which meant importing AgentProcessManager in tests executed
// realpathSync against the mocked "/fake" path and threw ENOENT — silently
// crashing 8 test suites before any `it()` ran. Deferred to first use instead.
let _extensionArgsCache: string[] | undefined;
let _extensionArgsNoLspCache: string[] | undefined;
let _builtinExtensionArgsCache: string[] | undefined;
let _builtinExtensionArgsNoLspCache: string[] | undefined;

/** 子代理进程保留正常 extension 能力，只跳过容易拖慢 ready 的 LSP。MCP 通过 PI_SKIP_MCP 禁用。 */
const SUBAGENT_EXCLUDED_EXTENSIONS = new Set(["lsp"]);

function getExtensionArgs(excludeLsp = false, includeUser = true): string[] {
  if (excludeLsp) {
    const cached = includeUser ? _extensionArgsNoLspCache : _builtinExtensionArgsNoLspCache;
    if (cached === undefined) {
      const flat = discoverExtensionArgs(includeUser);
      const filtered: string[] = [];
      for (let i = 0; i < flat.length; i += 2) {
        const flag = flat[i];
        const extPath = flat[i + 1];
        if (!extPath) continue;
        // 提取 extension 目录名（路径中 /extensions/<name>/index.ts 的 <name>）
        const match = extPath.match(/\/extensions\/([^/]+)\//);
        const extName = match?.[1] ?? "";
        if (!SUBAGENT_EXCLUDED_EXTENSIONS.has(extName)) {
          filtered.push(flag, extPath);
        }
      }
      if (includeUser) {
        _extensionArgsNoLspCache = ["--no-extensions", ...filtered];
      } else {
        _builtinExtensionArgsNoLspCache = ["--no-extensions", ...filtered];
      }
    }
    if (includeUser) {
      return _extensionArgsNoLspCache ?? ["--no-extensions"];
    }
    return _builtinExtensionArgsNoLspCache ?? ["--no-extensions"];
  }
  if (includeUser) {
    _extensionArgsCache ??= ["--no-extensions", ...discoverExtensionArgs(true)];
    return _extensionArgsCache;
  }
  _builtinExtensionArgsCache ??= ["--no-extensions", ...discoverExtensionArgs(false)];
  return _builtinExtensionArgsCache;
}

function getRemoteExtensionArgs(
  localExtensionsDir: string | undefined,
  remoteExtensionsDir: string | undefined,
  excludeLsp = false,
): string[] {
  if (!localExtensionsDir || !remoteExtensionsDir || !existsSync(localExtensionsDir)) {
    return ["--no-extensions"];
  }

  const localExtensionPaths: string[] = [];
  scanExtensionDir(localExtensionsDir, localExtensionPaths);
  const remoteArgs: string[] = [];
  for (const localExtensionPath of localExtensionPaths) {
    const relativePath = path.relative(localExtensionsDir, localExtensionPath);
    const extName = relativePath.split(path.sep)[0] ?? "";
    if (excludeLsp && SUBAGENT_EXCLUDED_EXTENSIONS.has(extName)) continue;
    remoteArgs.push(
      "--extension",
      `${remoteExtensionsDir}/${relativePath.split(path.sep).join("/")}`,
    );
  }
  return ["--no-extensions", ...remoteArgs];
}

// Tier constants and parseTierModel are imported from agent-runtime-config.ts

type SanitizedMessageUpdate = Extract<AgentEvent, { type: "message_update" }> & {
  assistantMessageEvent: Omit<AssistantMessageEvent, "partial">;
};

type SanitizedEvent = SanitizedMessageUpdate | Exclude<AgentEvent, { type: "message_update" }>;

type RpcClientInstance = RpcClientAPI;
type AgentStartResult = { agentId: string; status: "started" | "already_running" };

interface ManagedClient {
  client: RpcClientInstance;
  info: AgentProcessInfo;
  unsubscribe: () => void;
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
  /** Non-empty when this process hosts a delegated child session; LRU eviction skips such processes so background tasks are not killed mid-flight. */
  delegateParentSessionId?: string;
}

import type { AgentProcessInfo } from "../modules/agent";

let cachedModule: { RpcClient: new (options?: Record<string, unknown>) => RpcClientAPI } | null =
  null;

// 全局沙箱管理器（在 sandbox 模式下初始化）
let globalSandboxManager: SandboxManager | null = null;

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
      localPiPackagePath: path.resolve(config.remoteLocalPiPackagePath),
      localWorkspacePackagesPath: config.remoteLocalPiWorkspacePackagesPath
        ? path.resolve(config.remoteLocalPiWorkspacePackagesPath)
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
    provider.cleanupStaleSandboxes([]).catch((err) => {
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

async function createRpcClient(
  cliPath: string,
  cwd: string,
  sessionPath: string | undefined,
  userId?: string,
  excludeLsp = false,
): Promise<{ client: RpcClientInstance; timings: { dynamicImport: number; construct: number } }> {
  const t0 = performance.now();
  const runtime = await resolveActiveRuntimeSelection(cwd);
  const useRemoteChild = runtime.kind === "remote-agent-child";
  const remoteChildRuntime = runtime.kind === "remote-agent-child" ? runtime : undefined;

  // 沙箱模式：通过 SandboxRpcClient 转发到沙箱容器
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
  const remoteSessionId = useRemoteChild ? getSessionIdFromSessionPath(sessionPath) : undefined;
  const remoteSessionDir =
    useRemoteChild && remotePiAgentDir
      ? getRemoteChildSessionDir({ remotePiAgentDir, remoteCwd: runtime.remoteCwd })
      : undefined;
  const args = useRemoteChild
    ? [
        ...getRemoteExtensionArgs(
          localRemoteChildExtensionsDir,
          remoteChildBootstrap?.remoteExtensionsDir,
          excludeLsp,
        ),
        ...(remoteChildRuntime
          ? getRemoteProjectTrustArgs({ runtime: remoteChildRuntime, cwd })
          : []),
        ...(remoteSessionDir ? ["--session-dir", remoteSessionDir] : []),
        ...(remoteSessionId ? ["--session-id", remoteSessionId] : []),
      ]
    : [...getExtensionArgs(excludeLsp, runtime.kind !== "ssh-command")];
  if (!useRemoteChild && sessionPath && existsSync(sessionPath)) {
    args.push("--session", sessionPath);
  }

  perfLog.info("[createRpcClient] spawning CLI", {
    cliPath,
    cwd,
    remoteChild: useRemoteChild
      ? {
          target: runtime.target,
          remoteCwd: runtime.remoteCwd,
          cliPath: remoteChildCliPath,
          uploaded: remoteChildBootstrap?.uploaded,
          uploadedExtensions: remoteChildBootstrap?.uploadedExtensions,
          sha256: remoteChildBootstrap?.sha256.slice(0, 12),
          syncedResources: remoteResourceSync
            ? {
                uploaded: remoteResourceSync.uploaded,
                hash: remoteResourceSync.hash.slice(0, 12),
                resources: remoteResourceSync.resources.map((resource) => ({
                  type: resource.type,
                  files: resource.files,
                })),
                blocked: remoteResourceSync.blocked.length,
                remoteAgentDir: remoteResourceSync.remoteAgentDir,
              }
            : undefined,
        }
      : undefined,
    sessionPath,
    args: args.join(" "),
    excludeLsp,
  });

  // 子代理进程（forceNewProcess）跳过 MCP 连接，避免多进程竞争同一个 stdio MCP server
  const childEnv: Record<string, string> = {
    ...applyExecutionSandboxEnv(process.env, readProjectExecutionSandbox(cwd).mode),
    NODE_OPTIONS: "--max-old-space-size=8192",
  };
  if (excludeLsp) {
    childEnv.PI_SKIP_MCP = "1";
  }
  if (runtime.kind === "ssh-command") {
    Object.assign(childEnv, buildSshCommandRuntimeEnv(runtime.remoteProject));
  }

  const client = new cachedModule.RpcClient({
    cliPath: useRemoteChild ? remoteChildCliPath : cliPath,
    cwd,
    args,
    env: childEnv,
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
              skipMcp: excludeLsp,
              modelProxyEnv: modelProxy?.env,
            }),
          },
        }
      : {}),
  });
  attachModelProxyCleanup(client, modelProxy);
  try {
    await client.start();
    if (useRemoteChild) {
      attachRemoteSessionMirror({
        client,
        runtime,
        sessionId: remoteSessionId,
        localProjectPath: cwd,
        localSessionPath: sessionPath,
      });
    }
  } catch (err: unknown) {
    await modelProxy?.stop().catch(() => {});
    const debugClient = client as RpcClientInstance & {
      getStdout?: () => string;
      getStderr?: () => string;
      getProcessSnapshot?: () => {
        pid?: number;
        exitCode: number | null;
        signalCode: string | null;
      };
    };
    perfLog.error("[createRpcClient] client.start failed", {
      cwd,
      sessionPath,
      excludeLsp,
      argsCount: args.length,
      stderr:
        typeof debugClient.getStderr === "function" ? debugClient.getStderr().slice(-2000) : "",
      stdout:
        typeof debugClient.getStdout === "function" ? debugClient.getStdout().slice(-2000) : "",
      process:
        typeof debugClient.getProcessSnapshot === "function"
          ? debugClient.getProcessSnapshot()
          : undefined,
      err: err instanceof Error ? err.message : String(err),
      elapsedMs: Math.round(performance.now() - t1),
    });
    try {
      await client.stop();
    } catch (stopErr: unknown) {
      perfLog.warn("[createRpcClient] client.stop after failed start failed", {
        sessionPath,
        err: stopErr instanceof Error ? stopErr.message : String(stopErr),
      });
    }
    throw err;
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

function getSessionIdFromSessionPath(sessionPath: string | undefined): string | undefined {
  if (!sessionPath) return undefined;
  const fileName = path.basename(sessionPath);
  return fileName.endsWith(".jsonl") ? fileName.slice(0, -".jsonl".length) : fileName;
}

export class AgentProcessManager {
  private clients = new Map<string, ManagedClient>();
  /** CWD-based process tracking: projectPath → set of ManagedClients for that project */
  private processByCwd = new Map<string, Set<ManagedClient>>();
  private servers = new Set<RPCServer>();
  /** Per-session start de-dupe: repeated UI/subscription starts share the same client startup. */
  private _startPromises = new Map<string, Promise<AgentStartResult>>();
  /** Queued delegate requests received during start() */
  private _pendingDelegateRequests: Array<{
    sessionId: string;
    msg: unknown;
    channelName: string;
    resolve: (result: unknown) => void;
  }> = [];
  private sessionPaths = new Map<string, string>();
  /** Persistent projectPath per session — NOT cleaned on stop(), only on service restart.
      Allows restarting an inactive session when receiving delegate messages. */
  private sessionProjectPaths = new Map<string, string>();
  private leafIds = new Map<string, string | null>();
  private lastLspState = new Map<
    string,
    { state: string; servers: unknown[]; mode?: string; activeLanguages?: string[] }
  >();
  /** @internal Test access to coordinator handler */
  readonly coordinatorHandler!: CoordinatorHandler;

  private static MAX_POOL_SIZE = 5;

  private addToPool(poolKey: string, managed: ManagedClient): void {
    addToProcessPool(this.processByCwd, poolKey, managed);
  }

  private removeFromPool(poolKey: string, managed: ManagedClient): void {
    removeFromProcessPool(this.processByCwd, poolKey, managed);
  }

  private evictLRU(currentPoolKey: string): void {
    const candidate = selectLruEvictionCandidate(
      this.processByCwd,
      currentPoolKey,
      AgentProcessManager.MAX_POOL_SIZE,
    );
    if (!candidate) {
      const total = countProcessPoolEntries(this.processByCwd);
      if (total >= AgentProcessManager.MAX_POOL_SIZE) {
        // Pool is full but nothing eligible — likely all non-current entries are
        // streaming, running background tools, or protected delegate children.
        log.info("[evictLRU] pool full but no eviction candidate", {
          totalProcesses: total,
          poolKey: currentPoolKey,
        });
      }
      return;
    }

    const { poolKey, managed: oldest, totalProcesses } = candidate;
    const sid = oldest._activeSessionId;
    log.info("[evictLRU] evicting idle process", {
      totalBefore: totalProcesses,
      poolKey,
      sessionId: sid,
      isCurrentProject: poolKey === currentPoolKey,
    });
    oldest.unsubscribe();
    oldest.client.stop().catch(() => {});
    this.clients.delete(sid);
    this.lastLspState.delete(sid);
    removeFromProcessPool(this.processByCwd, poolKey, oldest);
  }

  private getPoolKey(projectPath: string, userId?: string): string {
    return makeProcessPoolKey(projectPath, userId, config.sandboxEnabled);
  }

  private messageReader: SessionMessageReader;
  private eventHandler!: AgentEventHandler;

  getSessionCache(
    sessionId: string,
    sessionPath: string,
  ): {
    messages: Array<{ entryId: string; message: unknown }>;
    customEntries: Array<{
      id: string;
      customType: string;
      data: unknown;
      timestamp: number;
    }>;
    compactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }>;
    deletionEntries?: Array<{ entryId: string; targetIds: string[] }>;
    parentById: Map<string, string | null>;
    lineCount: number;
    lastJsonlLeafPointer: string | null;
    activeJsonlLeafId: string | null;
    byteOffset: number;
    needsIncremental: boolean;
  } | null {
    return this.messageReader.getSessionCache(sessionId, sessionPath);
  }

  setSessionCache(
    sessionId: string,
    sessionPath: string,
    data: {
      messages: Array<{ entryId: string; message: unknown }>;
      customEntries: Array<{
        id: string;
        customType: string;
        data: unknown;
        timestamp: number;
      }>;
      compactionEntries: Array<{
        entryId: string;
        summary: string;
        tokensBefore?: number;
        timestamp: number;
      }>;
      deletionEntries?: Array<{ entryId: string; targetIds: string[] }>;
      parentById: Map<string, string | null>;
      lineCount: number;
      lastJsonlLeafPointer: string | null;
      activeJsonlLeafId: string | null;
      byteOffset?: number;
    },
  ): void {
    return this.messageReader.setSessionCache(sessionId, sessionPath, data);
  }

  clearSessionCache(sessionId?: string): void {
    return this.messageReader.clearSessionCache(sessionId);
  }

  async readJsonlFromLine(
    sessionPath: string,
    startLine: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{ newEntries: number; totalLines: number }> {
    return this.messageReader.readJsonlFromLine(
      sessionPath,
      startLine,
      messages,
      customEntries,
      parentById,
    );
  }

  async readJsonlFromByteOffset(
    sessionPath: string,
    byteOffset: number,
    messages: Array<{ entryId: string; message: unknown }>,
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>,
    parentById: Map<string, string | null>,
  ): Promise<{
    newEntries: number;
    totalLines: number;
    newByteOffset: number;
    newCompactionEntries: Array<{
      entryId: string;
      summary: string;
      tokensBefore?: number;
      timestamp: number;
    }>;
    newDeletionEntries: Array<{ entryId: string; targetIds: string[] }>;
    lastLeafPointer: string | null;
  }> {
    return this.messageReader.readJsonlFromByteOffset(
      sessionPath,
      byteOffset,
      messages,
      customEntries,
      parentById,
    );
  }

  private async _drainPendingDelegates(): Promise<void> {
    while (this._pendingDelegateRequests.length > 0) {
      const item = this._pendingDelegateRequests.shift();
      if (!item) break;
      const { sessionId, msg, resolve } = item;
      try {
        const call = msg as CoordinatorMethodCall;
        let delegateResult: unknown;
        if (call.__call === "session_delegate_sync") {
          delegateResult = await this.coordinatorHandler.handleCoordinatorDelegateSync(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
          );
        } else {
          delegateResult = await this.coordinatorHandler.handleCoordinatorDelegate(
            sessionId,
            call as Extract<CoordinatorMethodCall, { __call: "session_delegate" }>,
          );
        }
        resolve(delegateResult);
      } catch (err: unknown) {
        resolve({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  constructor(server: RPCServer) {
    this.servers.add(server);
    this.coordinatorHandler = new CoordinatorHandler({
      start: (sessionId, projectPath, sessionPath, options) =>
        this.start(sessionId, projectPath, sessionPath, options as Record<string, unknown>),
      stop: (sessionId) => this.stop(sessionId),
      send: (sessionId, content) => this.send(sessionId, content),
      steer: (sessionId, content) => this.steer(sessionId, content),
      followUp: (sessionId, content) => this.followUp(sessionId, content),
      broadcastEvent: (method, params, meta) => this.broadcastEvent(method, params, meta),
      setSessionName: (sessionId, name) => this.setSessionName(sessionId, name),
      switchAgent: (sessionId, agentName) => this.switchAgent(sessionId, agentName),
      setActiveTools: (sessionId, toolNames) => this.setActiveTools(sessionId, toolNames),
      setModel: (sessionId, provider, modelId) => this.setModel(sessionId, provider, modelId),
      setModelFromName: (sessionId, model, options) =>
        this.setModelFromName(sessionId, model, options),
      setPermissionMode: (sessionId, mode) => this.setPermissionMode(sessionId, mode),
      getState: (sessionId) => this.getState(sessionId),
      getStatus: (sessionId) => this.getStatus(sessionId),
      getContextUsage: (sessionId) => this.getContextUsage(sessionId),
      getActiveManaged: (sessionId) => this.getActiveManaged(sessionId) ?? undefined,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      clients: this.clients,
      processByCwd: this.processByCwd,
      isStartInProgress: () => false,
      queueDelegateRequest: (args) =>
        new Promise<unknown>((resolve) => {
          this._pendingDelegateRequests.push({ ...args, resolve });
        }),
    });
    this.messageReader = new SessionMessageReader({
      getActiveManaged: (sessionId) => this.getActiveManaged(sessionId) ?? undefined,
      resolveSessionPath: (sessionId) => this.resolveSessionPath(sessionId),
      _getSandboxUserId: (sessionId) => this._getSandboxUserId(sessionId) ?? undefined,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      clients: this.clients,
      getSandboxManager: () => globalSandboxManager,
      leafIds: this.leafIds,
    });
    this.eventHandler = new AgentEventHandler({
      broadcastEvent: (method, params, meta) => this.broadcastEvent(method, params, meta),
      broadcastSessionStatus: (sessionId, status) => this.broadcastSessionStatus(sessionId, status),
      emitAgentEvent: (sessionId, event) => this.emitAgentEvent(sessionId, event as SanitizedEvent),
      getActiveManaged: (sessionId) => this.getActiveManaged(sessionId) ?? undefined,
      findParentSession: (sessionId) =>
        this.coordinatorHandler.findParentSession(sessionId) ?? undefined,
      clients: this.clients,
      lastLspState: this.lastLspState,
      leafIds: this.leafIds,
      syncDelegateResolvers: this.coordinatorHandler
        .syncDelegateResolvers as AgentEventHandlerDeps["syncDelegateResolvers"],
      syncDelegateLastText: this.coordinatorHandler.syncDelegateLastText,
      subagentSyncChildren: this.coordinatorHandler.subagentSyncChildren,
      parentChildMap: this.coordinatorHandler.parentChildMap,
      delegateReplyCount: this.coordinatorHandler.delegateReplyCount,
      delegateCreatedAt: this.coordinatorHandler.delegateCreatedAt,
      delegateReplyMode: this.coordinatorHandler.delegateReplyMode,
      delegateReplyMetadata: this.coordinatorHandler.delegateReplyMetadata,
      delegateRepliedSessions: this.coordinatorHandler.delegateRepliedSessions,
      sendDelegateFallbackReply: (sessionId) =>
        this.coordinatorHandler.sendDelegateFallbackReply(sessionId),
    });
  }

  updateServer(server: RPCServer): void {
    this.servers.add(server);
  }

  removeServer(server: RPCServer): void {
    this.servers.delete(server);
  }

  serverCount(): number {
    return this.servers.size;
  }

  private async broadcastEvent(
    eventType: string,
    payload: unknown,
    metadata?: unknown,
  ): Promise<void> {
    for (const server of this.servers) {
      try {
        await server.emitEvent(eventType, payload, metadata);
      } catch (err: unknown) {
        log.warn("broadcastEvent failed, removing server", {
          eventType,
          err: err instanceof Error ? err.message : String(err),
        });
        this.servers.delete(server);
      }
    }
  }

  private broadcastSessionStatus(sessionId: string, status: string): void {
    const managed = this.getActiveManaged(sessionId);
    const projectPath = managed?.info.projectPath ?? "";
    this.broadcastEvent(
      "agent.session_status_changed",
      { sessionId, projectPath, status },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(session.status_changed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private toRemoteSshStatus(
    runtime: ActiveRuntimeSelection,
    projectPath: string,
    status: NonNullable<RemoteSshStatus["status"]>,
    error?: string,
  ): RemoteSshStatus | null {
    if (runtime.kind === "local") return null;
    if (runtime.kind === "ssh-command") {
      return {
        enabled: true,
        configured: true,
        status,
        host: runtime.remoteProject.host,
        remoteCwd: runtime.remoteProject.remotePath,
        localCwd: projectPath,
        sshArgs: runtime.remoteProject.sshArgs,
        shell: runtime.remoteProject.shell,
        error,
      };
    }
    return {
      enabled: true,
      configured: true,
      status,
      host: runtime.target,
      remoteCwd: runtime.remoteCwd,
      localCwd: projectPath,
      sshArgs: buildRemoteChildSshArgs(runtime),
      shell: runtime.shell,
      error,
    };
  }

  private async resolveRemoteSshStatus(
    projectPath: string,
    status: NonNullable<RemoteSshStatus["status"]>,
    error?: string,
  ): Promise<RemoteSshStatus | null> {
    const runtime = await resolveActiveRuntimeSelection(projectPath);
    return this.toRemoteSshStatus(runtime, projectPath, status, error);
  }

  private broadcastRemoteSshConnection(
    sessionId: string,
    projectPath: string,
    status: RemoteSshStatus | null,
  ): void {
    if (!status) return;
    this.broadcastEvent(
      "agent.ssh_connection_changed",
      { sessionId, projectPath, status },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(agent.ssh_connection_changed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async start(
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options?: { forceNewProcess?: boolean; userId?: string; delegateParentSessionId?: string },
  ): Promise<AgentStartResult> {
    const inFlightStart = this._startPromises.get(sessionId);
    if (inFlightStart) {
      log.info("[start] joining in-flight session start", { sessionId });
      return inFlightStart;
    }

    const existing = this.clients.get(sessionId);
    const connectingStatus =
      existing?._activeSessionId === sessionId
        ? null
        : await this.resolveRemoteSshStatus(projectPath, "connecting").catch((err: unknown) => {
            log.warn("resolve remote ssh status failed before start", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
            return null;
          });
    this.broadcastRemoteSshConnection(sessionId, projectPath, connectingStatus);

    const startPromise = startAgentClientOperation({
      sessionId,
      projectPath,
      sessionPath,
      startOptions: options,
      clients: this.clients,
      processByCwd: this.processByCwd,
      sessionPaths: this.sessionPaths,
      sessionProjectPaths: this.sessionProjectPaths,
      getPoolKey: (p, u) => this.getPoolKey(p, u),
      evictLRU: (k) => this.evictLRU(k),
      addToPool: (k, m) => this.addToPool(k, m),
      createRpcClient: (cliPath, cwd, sp, userId) =>
        createRpcClient(cliPath, cwd, sp, userId, options?.forceNewProcess === true),
      registerAgentChannels: (args) => registerAgentChannels(args),
      handleEvent: (sid, event) => this.handleEvent(sid, event),
      handleCoordinatorCall: (sid, data, channelName) =>
        this.handleCoordinatorCall(sid, data, channelName),
      broadcastSessionStatus: (sid, status) => this.broadcastSessionStatus(sid, status),
      drainPendingDelegates: () => {
        this._drainPendingDelegates();
      },
    });
    this._startPromises.set(sessionId, startPromise);
    try {
      const result = await startPromise;
      const persistedAgent = options?.delegateParentSessionId
        ? null
        : readPersistedSessionAgent(sessionPath);
      if (result.status === "started" && persistedAgent) {
        await this.switchAgent(sessionId, persistedAgent).catch((err: unknown) => {
          log.warn("[start] failed to restore persisted session agent", {
            sessionId,
            agent: persistedAgent,
            err: err instanceof Error ? err.message : String(err),
          });
        });
      }
      const connectedStatus = connectingStatus
        ? { ...connectingStatus, status: "connected" as const, error: undefined }
        : null;
      this.broadcastRemoteSshConnection(sessionId, projectPath, connectedStatus);
      return result;
    } catch (err) {
      const errorStatus = connectingStatus
        ? {
            ...connectingStatus,
            status: "error" as const,
            error: err instanceof Error ? err.message : String(err),
          }
        : null;
      this.broadcastRemoteSshConnection(sessionId, projectPath, errorStatus);
      throw err;
    } finally {
      if (this._startPromises.get(sessionId) === startPromise) {
        this._startPromises.delete(sessionId);
      }
    }
  }

  async send(sessionId: string, content: string, images?: ImageContent[]): Promise<boolean> {
    // Auto-fallback to steer when agent is already streaming.
    // This handles the race condition where the UI checks isStreaming (from
    // sessionStatusMap) as false but the managed client status has since
    // transitioned to "streaming" before sendPromptOperation runs.
    // See commit 83e14260f (sendPromptOperation guard) and 863de889 (regression).
    try {
      return await sendPromptOperation({
        sessionId,
        content,
        images,
        getActiveManaged: (sid) => this.getActiveManaged(sid),
        ensureManagedClient: (sid) => this.ensureManagedClient(sid),
        isClientAlive: (sid, m) => this.isClientAlive(sid, m),
        cleanupDeadClient: (sid, reason) => this.cleanupDeadClient(sid, reason),
        emitAgentEnd: (sid, reason) =>
          this.emitAgentEvent(
            sid,
            (reason ? { type: "agent_end", reason } : { type: "agent_end" }) as SanitizedEvent,
          ),
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("follow-up or steer")) {
        log.info("send: agent is streaming, falling back to steer", { sessionId });
        this.steer(sessionId, content, images);
        return true;
      }
      throw err;
    }
  }

  steer(
    sessionId: string,
    content?: string,
    images?: ImageContent[],
    options?: { promote?: number; immediate?: boolean },
  ): boolean {
    return steerOperation({
      sessionId,
      content,
      images,
      promote: options?.promote,
      immediate: options?.immediate,
      // Pass the managed client directly. RpcClientAPI already satisfies
      // SteeringClientLike (it has both steer(string, images?) and
      // steer({text,images,promote,immediate}) overloads). Wrapping it in
      // an adapter object loses the `this` binding on RpcClient.steer(),
      // which calls this.send() internally — see commit 05d9bec7 regression.
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  followUp(sessionId: string, content: string, images?: ImageContent[]): boolean {
    return followUpOperation({
      sessionId,
      content,
      images,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async abort(sessionId: string): Promise<boolean> {
    return abortOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      broadcastIdle: (sid) => this.broadcastSessionStatus(sid, "idle"),
      emitAgentEvent: (sid, event) => this.emitAgentEvent(sid, event),
    });
  }

  async setCwd(sessionId: string, cwd: string): Promise<boolean> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;
    await managed.client.setCwd(cwd).catch((err: unknown) => {
      log.warn("setCwd error", {
        sessionId,
        cwd,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    return true;
  }

  respondUI(sessionId: string, requestId: string, response: Record<string, unknown>): boolean {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return false;

    managed.client.respondUI(requestId, response);
    return true;
  }

  async stop(sessionId: string, crashReason?: string): Promise<boolean> {
    const managed = this.getActiveManaged(sessionId);
    const projectPath = managed?.info.projectPath ?? this.sessionProjectPaths.get(sessionId);
    const stopped = await stopAgentClientOperation({
      sessionId,
      crashReason,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      clients: this.clients,
      parentChildMap: this.coordinatorHandler.parentChildMap,
      delegateCreatedAt: this.coordinatorHandler.delegateCreatedAt,
      delegateReplyCount: this.coordinatorHandler.delegateReplyCount,
      delegateReplyMetadata: this.coordinatorHandler.delegateReplyMetadata,
      delegateRepliedSessions: this.coordinatorHandler.delegateRepliedSessions,
      syncDelegateResolvers: this.coordinatorHandler.syncDelegateResolvers,
      subagentSyncChildren: this.coordinatorHandler.subagentSyncChildren,
      syncDelegateLastText: this.coordinatorHandler.syncDelegateLastText,
      syncDelegateTimedOut: this.coordinatorHandler.syncDelegateTimedOut,
      leafIds: this.leafIds,
      getPoolKey: (cwd, userId) => this.getPoolKey(cwd, userId),
      removeFromPool: (k, m) => this.removeFromPool(k, m),
      stopChild: (sid) => this.stop(sid),
      emitAgentEvent: (sid, event) => this.emitAgentEvent(sid, event),
      deleteLspState: (sid) => this.lastLspState.delete(sid),
      clearSessionCache: (sid) => this.clearSessionCache(sid),
    });

    if (stopped && projectPath) {
      const remoteStatus = await this.resolveRemoteSshStatus(
        projectPath,
        crashReason ? "error" : "disconnected",
        crashReason,
      ).catch((err: unknown) => {
        log.warn("resolve remote ssh status failed after stop", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      this.broadcastRemoteSshConnection(sessionId, projectPath, remoteStatus);
    }

    return stopped;
  }

  getStatus(sessionId: string): { status: "idle" | "streaming" | "stopped"; pid?: number } {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return { status: "stopped" };
    return { status: managed.info.status };
  }

  batchGetSessionsStatus(
    sessionIds: string[],
  ): Array<{ sessionId: string; status: "idle" | "streaming" | "stopped" }> {
    return sessionIds.map((sid) => {
      const managed = this.getActiveManaged(sid);
      return { sessionId: sid, status: managed?.info.status ?? "stopped" };
    });
  }

  /**
   * Get the managed client for a session.
   * Each session now has its own dedicated CLI process.
   */
  private getActiveManaged(sessionId: string): ManagedClient | null {
    const managed = this.clients.get(sessionId);
    if (!managed) return null;
    if (managed._activeSessionId === sessionId) return managed;
    this.clients.delete(sessionId);
    return null;
  }

  /**
   * Ensure a managed client exists for the session.
   * If the managed client was GC'd, this rebuilds it from persisted
   * session/project metadata or a disk session scan.
   */
  private async ensureManagedClient(sessionId: string): Promise<ManagedClient | null> {
    return ensureManagedClientOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      sessionProjectPaths: this.sessionProjectPaths,
      sessionPaths: this.sessionPaths,
      findSessionById,
      sandboxEnabled: config.sandboxEnabled,
      getSandboxUserId: (sid) => this._getSandboxUserId(sid),
      start: (sid, projectPath, sessionPath, options) =>
        this.start(sid, projectPath, sessionPath, {
          forceNewProcess: false,
          userId: options.userId,
        }),
    });
  }

  private _getSandboxUserId(sessionId: string): string | null {
    if (!config.sandboxEnabled) return null;
    for (const [key, pool] of this.processByCwd) {
      for (const mc of pool) {
        if (mc._activeSessionId === sessionId && key.includes("::")) {
          return key.split("::")[1] ?? null;
        }
      }
    }
    for (const [, mc] of this.clients) {
      if (mc._activeSessionId === sessionId) {
        const projectPath = mc.info.projectPath;
        for (const [key] of this.processByCwd) {
          if (key.startsWith(`${projectPath}::`)) {
            return key.split("::")[1] ?? null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Check if a managed client's CLI process is still alive.
   * Uses a lightweight getState() probe — if it fails, the CLI likely OOM'd or crashed.
   */
  private async isClientAlive(sessionId: string, managed: ManagedClient): Promise<boolean> {
    try {
      // getState is cheap (scalar properties only, no serialization of messages)
      await withTimeout(managed.client.getState(), 10_000, "getState");
      return true;
    } catch (probeErr: unknown) {
      log.warn("CLI health check failed, process likely dead", {
        sessionId,
        probeErr: probeErr instanceof Error ? probeErr.message : String(probeErr),
      });
      return false;
    }
  }

  /**
   * Clean up a dead CLI client. Called when an RPC call fails and the CLI
   * process is confirmed dead (OOM, crash, killed).
   */
  private cleanupDeadClient(sessionId: string, reason: string): void {
    log.warn("[cleanupDeadClient] CLI process is dead, cleaning up", { sessionId, reason });
    const shortReason = reason.includes("heap limit")
      ? "Out of memory (OOM)"
      : reason.includes("prompt failed")
        ? "Agent process crashed"
        : "Agent process died";
    this.stop(sessionId, shortReason);
  }

  private resolveSessionPath(sessionId: string): string {
    const managed = this.clients.get(sessionId);
    if (managed) return managed.info.sessionPath;
    return this.sessionPaths.get(sessionId) ?? "";
  }

  async getState(sessionId: string): Promise<{
    model?: {
      id: string;
      name?: string;
      api?: string;
      provider?: string;
      reasoning?: boolean;
      contextWindow: number;
      maxTokens: number;
    };
    thinkingLevel?: string;
    isStreaming: boolean;
    isCompacting: boolean;
    steeringMode?: string;
    followUpMode?: string;
    permissionMode?: string;
    messageCount: number;
    streamingMessage?: AssistantMessage;
    activeToolExecutions: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
    pendingUIRequests?: ExtensionUIRequestEvent[];
  } | null> {
    let managed = this.getActiveManaged(sessionId);
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) return null;

    try {
      const state = await withTimeout(managed.client.getState(), 10_000, "getState");
      const stateWithStreaming = state as typeof state & {
        streamingMessage?: AssistantMessage;
        activeToolExecutions?: Array<{
          toolCallId: string;
          toolName: string;
          args?: unknown;
          startedAt?: number;
        }>;
        pendingUIRequests?: ExtensionUIRequestEvent[];
      };
      const model = state.model;
      const stateAny = state as unknown as Record<string, unknown>;
      return {
        model: model
          ? {
              id: String(model.id ?? ""),
              name: model.name ? String(model.name) : undefined,
              api: stateAny.api ? String(stateAny.api) : undefined,
              provider: model.provider ? String(model.provider) : undefined,
              reasoning: Boolean(model.reasoning),
              contextWindow: Number(model.contextWindow ?? 0),
              maxTokens: Number(model.maxTokens ?? 0),
            }
          : undefined,
        thinkingLevel: state.thinkingLevel ? String(state.thinkingLevel) : undefined,
        isStreaming: Boolean(state.isStreaming),
        isCompacting: Boolean(state.isCompacting),
        steeringMode: stateAny.steeringMode ? String(stateAny.steeringMode) : undefined,
        followUpMode: stateAny.followUpMode ? String(stateAny.followUpMode) : undefined,
        permissionMode: stateAny.permissionMode ? String(stateAny.permissionMode) : undefined,
        messageCount: Number(state.messageCount ?? 0),
        streamingMessage: stateWithStreaming.streamingMessage,
        activeToolExecutions: stateWithStreaming.activeToolExecutions ?? [],
        pendingUIRequests: stateWithStreaming.pendingUIRequests ?? [],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getState RPC failed, checking if CLI is alive", { sessionId, error: msg });
      if (!(await this.isClientAlive(sessionId, managed))) {
        this.cleanupDeadClient(sessionId, `getState failed: ${msg}`);
      }
      return null;
    }
  }

  async getCommands(
    sessionId: string,
  ): Promise<
    Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>
  > {
    return getCommandsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getSessionStats(sessionId: string): Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    toolCalls: number;
    totalMessages: number;
    userMessages?: number;
    assistantMessages?: number;
    toolResults?: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;

    try {
      const stats = await withTimeout(managed.client.getSessionStats(), 10_000, "getSessionStats");
      if (!stats) return null;
      const tokens = stats.tokens;
      const cu = stats.contextUsage;
      return {
        tokens: {
          input: Number(tokens?.input ?? 0),
          output: Number(tokens?.output ?? 0),
          cacheRead: Number(tokens?.cacheRead ?? 0),
          cacheWrite: Number(tokens?.cacheWrite ?? 0),
          total: Number(tokens?.total ?? 0),
        },
        cost: Number(stats.cost ?? 0),
        toolCalls: Number(stats.toolCalls ?? 0),
        totalMessages: Number(stats.totalMessages ?? 0),
        userMessages: Number(stats.userMessages ?? 0),
        assistantMessages: Number(stats.assistantMessages ?? 0),
        toolResults: Number(stats.toolResults ?? 0),
        contextUsage: cu
          ? {
              tokens: cu.tokens,
              contextWindow: Number(cu.contextWindow ?? 0),
              percent: cu.percent,
            }
          : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getSessionStats failed, checking if CLI is alive", {
        sessionId,
        err: msg,
      });
      if (!(await this.isClientAlive(sessionId, managed))) {
        this.cleanupDeadClient(sessionId, `getSessionStats failed: ${msg}`);
      }
      return null;
    }
  }

  async getMessages(
    sessionId: string,
    sessionPath?: string,
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }> {
    return this.messageReader.getMessages(sessionId, sessionPath);
  }

  async getFullMessages(
    sessionId: string,
    sessionPath?: string,
    options?: { limit?: number; afterEntryId?: string; fromStart?: boolean },
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }> {
    return this.messageReader.getFullMessages(sessionId, sessionPath, options);
  }

  async getMessageNavPage(
    sessionId: string,
    sessionPath?: string,
    options?: { limit?: number; afterEntryId?: string; beforeEntryId?: string; fromStart?: boolean },
  ): Promise<{
    messages: AgentMessageForUI[];
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }> {
    return getMessageNavPageOperation({
      sessionId,
      sessionPath,
      pagination: options,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      resolveSessionPath: (sid) => this.resolveSessionPath(sid),
      leafIds: this.leafIds,
      getSessionCache: (sid, resolvedSessionPath) => this.getSessionCache(sid, resolvedSessionPath),
      setSessionCache: (sid, resolvedSessionPath, data) =>
        this.setSessionCache(sid, resolvedSessionPath, data),
    });
  }

  async getFullMessagesAround(
    sessionId: string,
    sessionPath: string | undefined,
    options: { targetEntryId: string; before?: number; after?: number },
  ): Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    beforeCursor: string | null;
    afterCursor: string | null;
    targetFound: boolean;
    totalCount: number;
  }> {
    return getFullMessagesAroundOperation({
      sessionId,
      sessionPath,
      targetEntryId: options.targetEntryId,
      before: options.before,
      after: options.after,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      resolveSessionPath: (sid) => this.resolveSessionPath(sid),
      leafIds: this.leafIds,
      getSessionCache: (sid, resolvedSessionPath) => this.getSessionCache(sid, resolvedSessionPath),
      setSessionCache: (sid, resolvedSessionPath, data) =>
        this.setSessionCache(sid, resolvedSessionPath, data),
    });
  }

  async getAvailableModels(
    sessionId: string,
  ): Promise<Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>> {
    return getAvailableModelsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
      isClientAlive: (sid, m) => this.isClientAlive(sid, m),
      cleanupDeadClient: (sid, reason) => this.cleanupDeadClient(sid, reason),
    });
  }

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<{ provider: string; id: string }> {
    return setModelOperation({
      sessionId,
      provider,
      modelId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async setModelFromName(
    sessionId: string,
    model: string,
    options: {
      parentSessionId?: string;
      projectPath?: string;
    } = {},
  ): Promise<{ provider: string; id: string }> {
    const resolved = await this.resolveModelName(model, {
      parentSessionId: options.parentSessionId ?? sessionId,
      projectPath:
        options.projectPath ??
        this.sessionProjectPaths.get(sessionId) ??
        this.getActiveManaged(sessionId)?.info.projectPath,
    });
    return this.setModel(sessionId, resolved.provider, resolved.modelId);
  }

  async resolveModelName(
    model: string,
    options: {
      parentSessionId: string;
      projectPath?: string;
    },
  ): Promise<{ provider: string; modelId: string }> {
    const trimmed = model.trim();
    if (!trimmed) {
      throw new Error("Model is empty");
    }

    if (trimmed.includes("/")) {
      return parseExplicitModelName(trimmed);
    }

    const normalizedAlias = trimmed.toLowerCase();
    if (isTierKey(normalizedAlias)) {
      const resolved = await this.resolveTierModel({
        tier: normalizedAlias,
        parentSessionId: options.parentSessionId,
      });
      if (resolved) return resolved;
      throw new Error(`Tier "${normalizedAlias}" is not configured`);
    }

    throw new Error(
      `Invalid model "${model}". Expected format: provider/modelId or tier alias (${TIER_KEYS.join(
        "/",
      )})`,
    );
  }

  private async resolveTierModel(options: {
    tier: TierKey;
    parentSessionId: string;
  }): Promise<{ provider: string; modelId: string } | null> {
    const runtimeConfig = await this.getTierModels(options.parentSessionId).catch(() => null);
    const runtimeModel = runtimeConfig?.models?.[options.tier];
    if (runtimeModel) {
      return parseTierModel(options.tier, runtimeModel);
    }

    return null;
  }

  async switchTier(
    sessionId: string,
    tier: TierKey,
  ): Promise<{ provider: string; id: string; tier: TierKey }> {
    return switchTierOperation({
      tier,
      getTierModels: () => this.getTierModels(sessionId),
      setModel: (provider, modelId) => this.setModel(sessionId, provider, modelId),
    });
  }

  async cycleModel(sessionId: string): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: string;
    isScoped: boolean;
  } | null> {
    return cycleModelOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    return setThinkingLevelOperation({
      sessionId,
      level,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async cycleThinkingLevel(sessionId: string): Promise<{ level: string } | null> {
    return cycleThinkingLevelOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async compact(
    sessionId: string,
    customInstructions?: string,
  ): Promise<{ summary: string; tokensBefore: number }> {
    return compactOperation({
      sessionId,
      customInstructions,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    return setAutoCompactionOperation({
      sessionId,
      enabled,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async setAutoRetry(sessionId: string, enabled: boolean): Promise<void> {
    return setAutoRetryOperation({
      sessionId,
      enabled,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async abortRetry(sessionId: string): Promise<void> {
    return abortRetryOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async setSteeringMode(sessionId: string, mode: string): Promise<void> {
    return setSteeringModeOperation({
      sessionId,
      mode,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async setFollowUpMode(sessionId: string, mode: string): Promise<void> {
    return setFollowUpModeOperation({
      sessionId,
      mode,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async setPermissionMode(sessionId: string, mode: string): Promise<{ mode: string }> {
    const result = await setPermissionModeOperation({
      sessionId,
      mode,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
    const managed = this.clients.get(sessionId);
    if (managed) {
      managed.info.permissionMode = result.mode;
    }
    return result;
  }

  async getActiveTools(sessionId: string): Promise<{ toolNames: string[] }> {
    return getActiveToolsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async setActiveTools(sessionId: string, toolNames: string[]): Promise<void> {
    return setActiveToolsOperation({
      sessionId,
      toolNames,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getQueue(sessionId: string): Promise<{ steering: string[]; followUp: string[] }> {
    return getQueueOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async clearQueue(
    sessionId: string,
    item?: { type: "steering" | "followUp"; index: number; text: string },
  ): Promise<{ steering: string[]; followUp: string[] }> {
    return clearQueueOperation({
      sessionId,
      item,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async promoteQueuedFollowUp(
    sessionId: string,
    item: { type: "followUp"; index: number; text: string },
  ): Promise<{ steering: string[]; followUp: string[] }> {
    return promoteQueuedFollowUpOperation({
      sessionId,
      item,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getExtensions(sessionId: string): Promise<{
    extensions: Array<{
      path: string;
      resolvedPath: string;
      toolNames: string[];
      commandNames: string[];
    }>;
  }> {
    return getExtensionsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getSkills(sessionId: string): Promise<{
    skills: Array<{
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      disableModelInvocation: boolean;
    }>;
  }> {
    return getSkillsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async reload(sessionId: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    const status = managed?.info?.status;
    if (managed && status && status !== "idle") {
      log.info("reload: aborting active agent before reload", { sessionId, status });
      try {
        await this.abort(sessionId);
      } catch (err: unknown) {
        log.warn("reload: pre-reload abort failed; continuing with reload", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return reloadOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getTools(
    sessionId: string,
  ): Promise<{ tools: Array<{ name: string; label: string; description: string }> }> {
    return getToolsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getMcpServers(sessionId: string): Promise<{ servers: McpServerInfo[] }> {
    return getMcpServersOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async toggleMcpServer(
    sessionId: string,
    name: string,
    enabled: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    return toggleMcpServerOperation({
      sessionId,
      name,
      enabled,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async restartMcpServer(
    sessionId: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> {
    return restartMcpServerOperation({
      sessionId,
      name,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getContextUsage(
    sessionId: string,
  ): Promise<{ tokens: number | null; contextWindow: number; percent: number | null }> {
    return getContextUsageOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
      isClientAlive: async (sid, managed) => this.isClientAlive(sid, managed),
      cleanupDeadClient: (sid, reason) => this.cleanupDeadClient(sid, reason),
    });
  }

  async getTierModels(sessionId: string): Promise<{ models: Record<string, string> }> {
    return getTierModelsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async setTierModels(sessionId: string, models: Record<string, string>): Promise<{ ok: boolean }> {
    return setTierModelsOperation({
      sessionId,
      models,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getAgents(sessionId: string): Promise<{
    agents: Array<{
      name: string;
      description?: string;
      tier?: string;
      tools?: string[];
      permissionMode?: string;
      source: string;
      filePath: string;
      color?: string;
      avatar?: { type: "emoji"; value: string } | { type: "image"; src: string };
    }>;
  }> {
    return getAgentsOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async switchAgent(
    sessionId: string,
    agentName: string,
  ): Promise<{
    agentName: string;
    tools: string[];
    tier?: string;
    thinkingLevel?: string;
  }> {
    return switchAgentOperation({
      sessionId,
      agentName,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async getCurrentAgent(sessionId: string): Promise<{ agentName: string | null }> {
    return getCurrentAgentOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async getAgentDetail(sessionId: string, agentName: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.getAgentDetail(agentName);
  }

  async getAllTools(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error("Client not found");
    return managed.client.getAllTools();
  }

  async getSystemPrompt(sessionId: string) {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) throw new Error(`No client for session ${sessionId}`);
    return managed.client.getSystemPrompt();
  }

  async getLatestAgentChange(sessionId: string) {
    return getLatestAgentChangeOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
      ensureManagedClient: (sid) => this.ensureManagedClient(sid),
    });
  }

  async getSettings(sessionId: string, scope?: string): Promise<Record<string, unknown>> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return {};
    return managed.client
      .getSettings(scope as "global" | "project" | undefined)
      .then((s) => s as unknown as Record<string, unknown>)
      .catch((err: unknown) => {
        log.warn("getSettings error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {};
      });
  }

  async setSettings(
    sessionId: string,
    settings: Record<string, unknown>,
    scope?: string,
  ): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    await managed.client
      .setSettings(settings, scope as "global" | "project" | undefined)
      .catch((err: unknown) => {
        log.warn("setSettings error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
  }

  async setSessionName(sessionId: string, name: string): Promise<void> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    const projectPath = managed.info.projectPath;
    await managed.client.setSessionName(name).catch((err: unknown) => {
      log.warn("setSessionName error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
    this.broadcastEvent(
      "agent.session_renamed",
      { sessionId, projectPath, newName: name },
      {},
    ).catch((err: unknown) => {
      log.warn("broadcastEvent(session_renamed) error", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async getLastAssistantText(sessionId: string): Promise<{ text: string | null }> {
    return getLastAssistantTextOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getForkMessages(
    sessionId: string,
  ): Promise<{ messages: Array<{ entryId: string; text: string }> }> {
    return getForkMessagesOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async deleteEntries(sessionId: string, targetIds: string[]): Promise<{ entryId: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) {
      throw new Error("Client not found");
    }
    return managed.client.deleteEntries(targetIds);
  }

  async summarizeEntries(
    sessionId: string,
    targetIds: string[],
    options?: { summary?: string; model?: string },
  ): Promise<{ entryId: string }> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) {
      throw new Error("Client not found");
    }
    return managed.client.summarizeEntries(targetIds, options);
  }

  async fork(
    sessionId: string,
    entryId: string,
    options?: { position?: "before" | "at" },
  ): Promise<{
    text: string;
    cancelled: boolean;
    newSessionFile?: string;
    newSessionId?: string;
  }> {
    return forkOperation({
      sessionId,
      entryId,
      forkOptions: options,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async navigateTree(
    sessionId: string,
    targetId: string,
    options?: { summarize?: boolean; skipFiles?: boolean },
  ): Promise<{ cancelled: boolean; reason?: string }> {
    return this.messageReader.navigateTree(sessionId, targetId, options);
  }

  async previewRollback(
    sessionId: string,
    targetId: string,
  ): Promise<{ restored: string[]; deleted: string[] }> {
    return previewRollbackOperation({
      sessionId,
      targetId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getModifiedFiles(
    sessionId: string,
    fromEntryId?: string,
    toEntryId?: string,
    toUserMsgEntryId?: string,
  ): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      turnIndex: number;
      entryId: string;
    }>;
    resolvedFromEntryId: string | null;
    targetTreeHash?: string | null;
  }> {
    return getModifiedFilesOperation({
      sessionId,
      fromEntryId,
      toEntryId,
      toUserMsgEntryId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getFileDiff(
    sessionId: string,
    filePath: string,
    fromHash?: string,
    toHash?: string,
  ): Promise<{
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
  } | null> {
    return getFileDiffOperation({
      sessionId,
      filePath,
      fromHash,
      toHash,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getBatchDiffs(
    sessionId: string,
    fromEntryId?: string,
    toEntryId?: string,
  ): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      diff: {
        path: string;
        oldContent: string | null;
        newContent: string | null;
        unifiedDiff: string;
      } | null;
    }>;
    summary: { totalFiles: number; added: number; modified: number; deleted: number };
  }> {
    return getBatchDiffsOperation({
      sessionId,
      fromEntryId,
      toEntryId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async getTree(sessionId: string): Promise<{ entries: TreeEntry[]; leafId?: string | null }> {
    return this.messageReader.getTree(sessionId);
  }

  async restoreFilesFromSnapshot(
    sessionId: string,
    snapshotTreeHash: string,
    files?: string[],
  ): Promise<string[]> {
    return restoreFilesFromSnapshotOperation({
      sessionId,
      snapshotTreeHash,
      files,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async clone(sessionId: string): Promise<{ cancelled: boolean }> {
    return cloneOperation({
      sessionId,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async newSession(sessionId: string, parentSession?: string): Promise<{ cancelled: boolean }> {
    return newSessionOperation({
      sessionId,
      parentSession,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  async exportHtml(sessionId: string, outputPath?: string): Promise<{ path: string }> {
    return exportHtmlOperation({
      sessionId,
      outputPath,
      getActiveManaged: (sid) => this.getActiveManaged(sid),
    });
  }

  sendChannelData(sessionId: string, channelName: string, data: unknown): void {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return;
    const ch = managed.client.channel(channelName);
    ch.send(data);
  }

  callChannel<CN extends keyof ChannelTypeRegistry, MN extends ChannelMethodKeys<CN>>(
    sessionId: string,
    channelName: CN,
    method: MN,
    params: ChannelMethodParams<CN, MN>,
  ): Promise<ChannelMethodReturn<CN, MN>>;

  callChannel(
    sessionId: string,
    channelName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;

  async callChannel(
    sessionId: string,
    channelName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    let managed = this.getActiveManaged(sessionId);
    if (!managed) {
      // Wait up to 1.6s for agent process to finish starting (spawn takes ~1.5s)
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 200));
        managed = this.getActiveManaged(sessionId);
        if (managed) break;
      }
    }
    managed ??= await this.ensureManagedClient(sessionId);
    if (!managed) throw new Error("Client not found");
    const ch = managed.client.channel(channelName);
    return ch.call(method, params);
  }

  private handleEvent(sessionId: string, event: AgentEvent): void {
    this.eventHandler.handleEvent(sessionId, event);
  }

  private async handleCoordinatorCall(
    sessionId: string,
    data: unknown,
    channelName: string,
  ): Promise<void> {
    return this.coordinatorHandler.handleCoordinatorCall(sessionId, data, channelName);
  }

  private async emitAgentEvent(sessionId: string, event: SanitizedEvent): Promise<void> {
    await this.broadcastEvent("agent.event", { sessionId, event }, { sessionId });
  }

  async sendChannelMessage(
    sessionId: string,
    channelName: string,
    data: unknown,
  ): Promise<unknown> {
    const managed = this.getActiveManaged(sessionId);
    if (!managed) return null;
    try {
      const ch = managed.client.channel(channelName);
      return await ch.invoke(data);
    } catch (err: unknown) {
      log.warn("sendChannelMessage failed", {
        sessionId,
        channelName,
        err: (err as Error).message,
      });
      return null;
    }
  }

  hasSession(sessionId: string): boolean {
    const managed = this.getActiveManaged(sessionId);
    return managed !== null;
  }

  getProjectPath(sessionId: string): string | undefined {
    const managed = this.getActiveManaged(sessionId);
    return managed?.info?.projectPath;
  }

  getProjectPathForSession(sessionId: string): string | undefined {
    const managed = this.getActiveManaged(sessionId);
    return managed?.info?.projectPath ?? this.sessionProjectPaths.get(sessionId);
  }

  getSessionPath(sessionId: string): string {
    const managed = this.getActiveManaged(sessionId);
    if (managed) return managed.info.sessionPath;
    return this.sessionPaths.get(sessionId) ?? "";
  }

  getCachedLspState(
    sessionId: string,
  ): { state: string; servers: unknown[]; mode?: string } | undefined {
    return this.lastLspState.get(sessionId);
  }
}
