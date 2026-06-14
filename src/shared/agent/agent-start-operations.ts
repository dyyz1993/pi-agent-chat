import { performance } from "perf_hooks";

import type { AgentEvent, AgentProcessInfo, ChannelDataEvent } from "../modules/agent";
import { config } from "../../server-config";
import { createLogger } from "../lib/logger";
import type { ChannelRegistrableClient } from "./agent-channel-registration";

const log = createLogger("agent");
const perfLog = createLogger("session-perf");

export interface StartManagedClient {
  client: ChannelRegistrableClient & {
    switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
    stop(): Promise<void>;
    onEvent(handler: (event: unknown) => void): () => void;
  };
  info: AgentProcessInfo;
  unsubscribe: () => void;
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
}

interface CreateRpcClientTimings {
  dynamicImport: number;
  construct: number;
}

export async function startAgentClientOperation<TManaged extends StartManagedClient>(options: {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  startOptions?: { forceNewProcess?: boolean; userId?: string };
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
  ) => Promise<{ client: TManaged["client"]; timings: CreateRpcClientTimings }>;
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
}): Promise<{ agentId: string; status: "started" | "already_running" | "switched" }> {
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

    const reusePoolKey = options.getPoolKey(options.projectPath, options.startOptions?.userId);
    const pool = options.processByCwd.get(reusePoolKey);
    if (pool && pool.size > 0) {
      const pooled = [...pool][pool.size - 1];
      const oldSessionId = pooled._activeSessionId;
      const tSwitch = performance.now();
      try {
        perfLog.info("[start] reusing pooled process", {
          sessionId: options.sessionId,
          projectPath: options.projectPath,
          oldSessionId,
        });
        const result = await Promise.race([
          pooled.client.switchSession(options.sessionPath),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("switchSession timed out after 15s")), 15000),
          ),
        ]);
        if (!result.cancelled) {
          options.clients.delete(oldSessionId);
          pooled._activeSessionId = options.sessionId;
          pooled.info = {
            sessionId: options.sessionId,
            projectPath: options.projectPath,
            sessionPath: options.sessionPath,
            status: "idle",
          };
          options.clients.set(options.sessionId, pooled);
          options.sessionPaths.set(options.sessionId, options.sessionPath);
          options.sessionProjectPaths.set(options.sessionId, options.projectPath);
          perfLog.info("[start] switchSession done", {
            sessionId: options.sessionId,
            oldSessionId,
            totalMs: Math.round(performance.now() - tSwitch),
          });
          return { agentId: options.sessionId, status: "switched" };
        }
        perfLog.info("[start] switchSession cancelled by extension, creating new process");
      } catch (err: unknown) {
        const switchMs = Math.round(performance.now() - tSwitch);
        perfLog.info("[start] switchSession failed, killing pooled process", {
          sessionId: options.sessionId,
          oldSessionId,
          switchMs,
          error: err instanceof Error ? err.message : String(err),
        });
        options.processByCwd.delete(options.projectPath);
        options.clients.delete(oldSessionId);
        try {
          pooled.unsubscribe();
        } catch (e) {
          log.debug("start: failed to unsubscribe old pooled process", { error: String(e) });
        }
        try {
          await pooled.client.stop();
        } catch (e) {
          log.debug("start: failed to stop old pooled process client", { error: String(e) });
        }
      }
    }

    const poolKey = options.getPoolKey(options.projectPath, options.startOptions?.userId);
    perfLog.info("[start] begin (new process)", {
      sessionId: options.sessionId,
      projectPath: options.projectPath,
    });

    options.evictLRU(poolKey);

    const { client, timings: createTimings } = await options.createRpcClient(
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
      lastActiveAt: now(),
      activeBackgroundTools: new Set<string>(),
    } as unknown as TManaged;

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
    options.sessionPaths.set(options.sessionId, options.sessionPath);
    options.sessionProjectPaths.set(options.sessionId, options.projectPath);
    options.clients.set(options.sessionId, managed);
    options.addToPool(poolKey, managed);
    options.drainPendingDelegates?.();
    options.broadcastSessionStatus(options.sessionId, "idle");
    return { agentId: options.sessionId, status: "started" };
  } finally {
    options.releaseStartLock?.();
  }
}
