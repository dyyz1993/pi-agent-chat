import { performance } from "perf_hooks";

import type { AgentEvent, AgentProcessInfo, ChannelDataEvent } from "../modules/agent";
import { config } from "../../server-config";
import { createLogger } from "../lib/logger";
import type { ChannelRegistrableClient } from "./agent-channel-registration";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

export interface StartManagedClient {
  client: ChannelRegistrableClient & {
    stop(): Promise<void>;
    onEvent(handler: (event: unknown) => void): () => void;
    /** Fast same-cwd session switch (fork RPC). Present on warm-eligible clients. */
    switchSession?(sessionPath: string): Promise<{ cancelled: boolean }>;
    /** Read current session identity (post-switch sessionId). */
    getState?(): Promise<{ sessionId: string; sessionFile?: string }>;
  };
  info: AgentProcessInfo;
  unsubscribe: () => void;
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
  /** OS pid of the spawned CLI child — recorded at spawn for stop-time reaping. */
  _childPid?: number;
  /** Non-empty for delegated child sessions; LRU eviction skips these. */
  delegateParentSessionId?: string;
}

/**
 * Warm process pool: pre-spawned CLI processes waiting for a session to bind.
 * Keyed by poolKey (projectPath[:userId]) — a warm process spawned for cwd X
 * can serve any session under X via switchSession (fast same-cwd path).
 */
export interface WarmPoolEntry<TManaged = unknown> {
  managed: TManaged;
  /** cwd the process was spawned with — must equal projectPath to reuse. */
  cwd: string;
  createdAt: number;
}

export function takeWarmProcess<TManaged extends StartManagedClient>(
  warmPool: Map<string, WarmPoolEntry[]>,
  poolKey: string,
  projectPath: string,
): TManaged | undefined {
  const list = warmPool.get(poolKey);
  if (!list || list.length === 0) return undefined;
  const idx = list.findIndex((e) => e.cwd === projectPath);
  if (idx < 0) return undefined;
  const [entry] = list.splice(idx, 1);
  return entry.managed as TManaged;
}

interface CreateRpcClientTimings {
  dynamicImport: number;
  construct: number;
}

export async function startAgentClientOperation<TManaged extends StartManagedClient>(options: {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  startOptions?: { forceNewProcess?: boolean; userId?: string; delegateParentSessionId?: string };
  clients: Map<string, TManaged>;
  processByCwd: Map<string, Set<TManaged>>;
  sessionPaths: Map<string, string>;
  sessionProjectPaths: Map<string, string>;
  getPoolKey: (projectPath: string, userId?: string) => string;
  evictLRU: (poolKey: string) => void;
  addToPool: (poolKey: string, managed: TManaged) => void;
  createRpcClient: (
    cliPath: string,
    projectPath: string,
    sessionPath: string,
    userId?: string,
  ) => Promise<{ client: TManaged["client"]; timings: CreateRpcClientTimings; pid?: number }>;
  registerAgentChannels: (args: {
    client: ChannelRegistrableClient;
    getSessionId: () => string;
    handleCoordinatorCall: (sessionId: string, data: unknown, channelName: string) => void;
    handleChannelData: (sessionId: string, event: ChannelDataEvent) => void;
  }) => number;
  handleEvent: (sessionId: string, event: AgentEvent) => void;
  handleCoordinatorCall: (sessionId: string, data: unknown, channelName: string) => void;
  broadcastSessionStatus: (sessionId: string, status: string) => void;
  now?: () => number;
  acquireStartLock?: (sessionId: string) => Promise<boolean>;
  releaseStartLock?: () => void;
  drainPendingDelegates?: () => void;
  /** Warm pool lookup — when provided, pre-spawned processes are reused via fast switchSession. */
  takeWarmProcess?: (poolKey: string, projectPath: string) => TManaged | undefined;
}): Promise<{ agentId: string; status: "started" | "already_running" }> {
  const tStart = performance.now();
  const now = options.now ?? Date.now;

  if (options.acquireStartLock) {
    const acquired = await options.acquireStartLock(options.sessionId);
    if (!acquired) {
      return { agentId: options.sessionId, status: "already_running" };
    }
  }

  try {
    const existing = options.clients.get(options.sessionId);
    if (existing && existing._activeSessionId === options.sessionId) {
      perfLog.info("[start] already_running (cached hit)", {
        sessionId: options.sessionId,
        totalMs: Math.round(performance.now() - tStart),
      });
      existing.lastActiveAt = now();
      options.drainPendingDelegates?.();
      return { agentId: options.sessionId, status: "already_running" };
    }

    const poolKey = options.getPoolKey(options.projectPath, options.startOptions?.userId);
    perfLog.info("[start] begin (new process)", {
      sessionId: options.sessionId,
      projectPath: options.projectPath,
    });

    // Warm pool fast path: reuse a pre-spawned CLI process via the fork's
    // fast same-cwd switchSession (~tens of ms) instead of a cold spawn.
    if (options.takeWarmProcess) {
      const warm = options.takeWarmProcess(poolKey, options.projectPath);
      if (warm) {
        try {
          perfLog.info("[start] warm pool hit — switching session", { sessionId: options.sessionId });
          const tSwitch = performance.now();
          const sw = await warm.client.switchSession?.(options.sessionPath);
          const switchMs = Math.round(performance.now() - tSwitch);
          if (sw && !sw.cancelled) {
            const tState = performance.now();
            const state = await warm.client.getState?.();
            const stateMs = Math.round(performance.now() - tState);
            const newSessionId = state?.sessionId ?? options.sessionId;
            perfLog.info("[start] warm switch timings", { switchMs, stateMs });
            perfLog.info("[start] warm switch timings", { switchMs, stateMs, totalMs: Math.round(performance.now() - tStart) });
            warm._activeSessionId = newSessionId;
            warm.info.sessionId = newSessionId;
            warm.info.sessionPath = options.sessionPath;
            warm.info.projectPath = options.projectPath;
            warm.lastActiveAt = now();
            options.sessionPaths.set(newSessionId, options.sessionPath);
            options.sessionProjectPaths.set(newSessionId, options.projectPath);
            options.clients.set(newSessionId, warm);
            options.addToPool(poolKey, warm);
            options.registerAgentChannels({
              client: warm.client,
              getSessionId: () => warm._activeSessionId,
              handleCoordinatorCall: options.handleCoordinatorCall,
              handleChannelData: (activeSessionId, event) => {
                options.handleEvent(activeSessionId, event as AgentEvent);
              },
            });
            log.info("Warm process adopted for session", {
              sessionId: options.sessionId,
              newSessionId,
              totalMs: Math.round(performance.now() - tStart),
            });
            options.broadcastSessionStatus(newSessionId, "idle");
            return { agentId: newSessionId, status: "started" };
          }
          // cancelled or no switchSession support — fall through to cold spawn,
          // but the warm process is now orphaned; stop it.
          warm.client.stop().catch(() => {});
        } catch (err) {
          log.warn("Warm process switch failed, falling back to cold spawn", {
            sessionId: options.sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
          warm.client.stop().catch(() => {});
        }
      }
    }

    options.evictLRU(poolKey);

    const { client, timings: createTimings, pid: childPid } = await options.createRpcClient(
      config.piCliPath,
      options.projectPath,
      options.sessionPath,
      config.sandboxEnabled ? (options.startOptions?.userId ?? options.sessionId) : undefined,
    );
    const tAfterCreate = performance.now();

    log.info("Spawning pi via RpcClient", {
      cwd: options.projectPath,
      sessionPath: options.sessionPath,
    });

    const managed = {
      client,
      info: {
        sessionId: options.sessionId,
        projectPath: options.projectPath,
        sessionPath: options.sessionPath,
        status: "idle",
      },
      unsubscribe: () => undefined,
      _activeSessionId: options.sessionId,
      _childPid: childPid,
      lastActiveAt: now(),
      activeBackgroundTools: new Set<string>(),
      ...(options.startOptions?.delegateParentSessionId
        ? { delegateParentSessionId: options.startOptions.delegateParentSessionId }
        : {}),
    } as unknown as TManaged;

    options.sessionPaths.set(options.sessionId, options.sessionPath);
    options.sessionProjectPaths.set(options.sessionId, options.projectPath);
    options.clients.set(options.sessionId, managed);
    options.addToPool(poolKey, managed);

    const bridge = (event: unknown): void => {
      options.handleEvent(managed._activeSessionId, event as AgentEvent);
    };
    try {
      managed.unsubscribe = client.onEvent(bridge);
    } catch {
      managed.unsubscribe = () => undefined;
    }

    const channelsRegistered = options.registerAgentChannels({
      client,
      getSessionId: () => managed._activeSessionId,
      handleCoordinatorCall: options.handleCoordinatorCall,
      handleChannelData: (activeSessionId, event) => {
        options.handleEvent(activeSessionId, event as AgentEvent);
      },
    });

    const processStartMs = Math.round(performance.now() - tAfterCreate);
    perfLog.info("[start] RpcClient ready", {
      sessionId: options.sessionId,
      totalMs: Math.round(performance.now() - tStart),
      dynamicImportMs: createTimings.dynamicImport,
      constructMs: createTimings.construct,
      createRpcTotalMs: Math.round(tAfterCreate - tStart),
      processStartMs,
      channelsRegistered,
    });

    log.info("RpcClient started", { sessionId: options.sessionId });
    options.drainPendingDelegates?.();
    options.broadcastSessionStatus(options.sessionId, "idle");
    return { agentId: options.sessionId, status: "started" };
  } finally {
    options.releaseStartLock?.();
  }
}
