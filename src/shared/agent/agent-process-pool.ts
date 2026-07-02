export interface ProcessPoolEntry {
  _activeSessionId: string;
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
  info: {
    status: string;
  };
  /** Non-empty for delegated child sessions; LRU eviction skips these to avoid killing background tasks. */
  delegateParentSessionId?: string;
}

export interface EvictionCandidate<T extends ProcessPoolEntry> {
  poolKey: string;
  managed: T;
  totalProcesses: number;
}

export function makeProcessPoolKey(
  projectPath: string,
  userId: string | undefined,
  sandboxEnabled: boolean,
): string {
  return sandboxEnabled && userId ? `${projectPath}::${userId}` : projectPath;
}

export function addToProcessPool<T>(pools: Map<string, Set<T>>, poolKey: string, managed: T): void {
  let pool = pools.get(poolKey);
  if (!pool) {
    pool = new Set();
    pools.set(poolKey, pool);
  }
  pool.add(managed);
}

export function removeFromProcessPool<T>(
  pools: Map<string, Set<T>>,
  poolKey: string,
  managed: T,
): void {
  const pool = pools.get(poolKey);
  if (!pool) return;
  pool.delete(managed);
  if (pool.size === 0) {
    pools.delete(poolKey);
  }
}

export function countProcessPoolEntries<T>(pools: Map<string, Set<T>>): number {
  return [...pools.values()].reduce((sum, pool) => sum + pool.size, 0);
}

export function selectLruEvictionCandidate<T extends ProcessPoolEntry>(
  pools: Map<string, Set<T>>,
  currentPoolKey: string,
  maxPoolSize: number,
): EvictionCandidate<T> | null {
  const totalProcesses = countProcessPoolEntries(pools);
  if (totalProcesses < maxPoolSize) return null;

  let oldest: T | null = null;
  let oldestPoolKey: string | null = null;

  const currentPoolSize = pools.get(currentPoolKey)?.size ?? 0;

  for (const [poolKey, pool] of pools) {
    for (const managed of pool) {
      if (managed.info.status === "streaming") continue;
      if (managed.activeBackgroundTools.size > 0) continue;
      // Never evict delegated child sessions — they run background tasks and may
      // be in the idle gap between session_start and the first agent_start event
      // (e.g. waiting for the first LLM response). Evicting them causes
      // empty_response errors on the parent side.
      if (managed.delegateParentSessionId) continue;

      const isCurrentProject = poolKey === currentPoolKey;
      if (isCurrentProject && currentPoolSize <= 1) continue;

      if (!oldest) {
        oldest = managed;
        oldestPoolKey = poolKey;
        continue;
      }

      const oldestIsCurrent = oldestPoolKey === currentPoolKey;
      if (!isCurrentProject && oldestIsCurrent) {
        oldest = managed;
        oldestPoolKey = poolKey;
      } else if (
        isCurrentProject === oldestIsCurrent &&
        managed.lastActiveAt < oldest.lastActiveAt
      ) {
        oldest = managed;
        oldestPoolKey = poolKey;
      }
    }
  }

  if (!oldest || !oldestPoolKey) return null;
  return { poolKey: oldestPoolKey, managed: oldest, totalProcesses };
}
