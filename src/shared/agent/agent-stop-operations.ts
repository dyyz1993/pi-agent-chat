import type { SanitizedEvent } from "./hold-events";
import { createLogger } from "../lib/logger";
import {
  cleanupStoppedDelegateSession,
  type DelegateChildMap,
  type SyncDelegateResolver,
} from "./coordinator-session-state";

const log = createLogger("agent");

interface StopManagedClient {
  client: {
    getTreeWithLeaf: () => Promise<{ leafId?: string | null }>;
    stop: () => Promise<unknown>;
  };
  info: {
    status: string;
    projectPath: string;
  };
  unsubscribe: () => void;
  _activeSessionId: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

export async function stopAgentClientOperation<TManaged extends StopManagedClient>(options: {
  sessionId: string;
  crashReason?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  clients: Map<string, TManaged>;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  syncDelegateResolvers: Map<string, SyncDelegateResolver>;
  subagentSyncChildren: Set<string>;
  syncDelegateLastText: Map<string, string>;
  leafIds: Map<string, string>;
  getPoolKey: (cwd: string, userId?: string) => string;
  removeFromPool: (poolKey: string, managed: TManaged) => void;
  stopChild: (sessionId: string) => Promise<boolean>;
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>;
  deleteLspState: (sessionId: string) => void;
  clearSessionCache: (sessionId: string) => void;
}): Promise<boolean> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return false;

  managed.info.status = "idle";
  const endEvent = options.crashReason
    ? ({ type: "agent_end", reason: options.crashReason } as unknown as SanitizedEvent)
    : ({ type: "agent_end" } as SanitizedEvent);
  options.emitAgentEvent(options.sessionId, endEvent).catch((err: unknown) => {
    log.warn("emitAgentEvent(agent_end) error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  });

  const stopCleanup = cleanupStoppedDelegateSession({
    sessionId: options.sessionId,
    parentChildMap: options.parentChildMap,
    delegateCreatedAt: options.delegateCreatedAt,
    delegateReplyCount: options.delegateReplyCount,
    syncDelegateResolvers: options.syncDelegateResolvers,
    subagentSyncChildren: options.subagentSyncChildren,
    syncDelegateLastText: options.syncDelegateLastText,
  });
  for (const childId of stopCleanup.childSessionIds) {
    void options.stopChild(childId);
  }

  try {
    const treeResult = await withTimeout(
      managed.client.getTreeWithLeaf(),
      3_000,
      "getTreeWithLeaf-stop",
    );
    if (treeResult.leafId) {
      options.leafIds.set(options.sessionId, treeResult.leafId);
    }
  } catch {
    // Best effort — process may already be unresponsive.
  }

  managed.unsubscribe();
  managed.client.stop().catch((err: unknown) => {
    log.warn("stop error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
  options.clients.delete(options.sessionId);

  const poolKey = options.getPoolKey(managed.info.projectPath);
  options.removeFromPool(poolKey, managed);
  const sandboxKey = options.getPoolKey(managed.info.projectPath, managed._activeSessionId);
  if (sandboxKey !== poolKey) {
    options.removeFromPool(sandboxKey, managed);
  }

  options.deleteLspState(options.sessionId);
  options.clearSessionCache(options.sessionId);
  return true;
}
