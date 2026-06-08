import { createLogger } from "../lib/logger";

const log = createLogger("agent");

/**
 * Dedup map: ensures only one `ensureManagedClientOperation` runs per session
 * at a time. Concurrent callers share the same Promise.
 */
const pendingEnsureOperations = new Map<string, Promise<unknown>>();

interface ManagedSessionClient {
  info: {
    projectPath: string;
    sessionPath?: string;
  };
  _activeSessionId: string;
}

export function findSandboxUserIdForSession<TManaged extends ManagedSessionClient>(options: {
  sessionId: string;
  sandboxEnabled: boolean;
  processByCwd: Map<string, Set<TManaged>>;
  clients: Map<string, TManaged>;
}): string | null {
  if (!options.sandboxEnabled) return null;
  for (const [key, pool] of options.processByCwd) {
    for (const managed of pool) {
      if (managed._activeSessionId === options.sessionId && key.includes("::")) {
        return key.split("::")[1] ?? null;
      }
    }
  }
  for (const [, managed] of options.clients) {
    if (managed._activeSessionId === options.sessionId) {
      const projectPath = managed.info.projectPath;
      for (const [key] of options.processByCwd) {
        if (key.startsWith(`${projectPath}::`)) {
          return key.split("::")[1] ?? null;
        }
      }
    }
  }
  return null;
}

export async function ensureManagedClientOperation<TManaged extends ManagedSessionClient>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  sessionProjectPaths: Map<string, string>;
  sessionPaths: Map<string, string>;
  findSessionById: (
    sessionId: string,
  ) => Promise<{ projectPath: string; sessionPath: string } | null>;
  sandboxEnabled: boolean;
  getSandboxUserId: (sessionId: string) => string | null;
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
    options: { forceNewProcess: false; userId?: string },
  ) => Promise<{ status: string }>;
}): Promise<TManaged | null> {
  // Fast path: already have a live client
  const existing = options.getActiveManaged(options.sessionId);
  if (existing) return existing;

  // Dedup: if another call is already starting this session, piggyback on it
  const pending = pendingEnsureOperations.get(options.sessionId);
  if (pending) {
    log.info("[ensureManagedClient] dedup: waiting for in-flight start", {
      sessionId: options.sessionId,
    });
    await pending;
    return options.getActiveManaged(options.sessionId);
  }

  // Create the actual operation promise
  const operationPromise = (async (): Promise<TManaged | null> => {
    // Re-check after awaiting (another caller might have completed)
    const rechecked = options.getActiveManaged(options.sessionId);
    if (rechecked) return rechecked;

    let projectPath = options.sessionProjectPaths.get(options.sessionId);
    let sessionPath = options.sessionPaths.get(options.sessionId);
    if (!projectPath || !sessionPath) {
      const session = await options.findSessionById(options.sessionId);
      if (session) {
        projectPath = session.projectPath;
        sessionPath = session.sessionPath;
        options.sessionProjectPaths.set(options.sessionId, projectPath);
        options.sessionPaths.set(options.sessionId, sessionPath);
      }
    }

    if (!projectPath || !sessionPath) {
      log.warn("[ensureManagedClient] session metadata not found", { sessionId: options.sessionId });
      return null;
    }

    const userId = options.sandboxEnabled
      ? (options.getSandboxUserId(options.sessionId) ?? options.sessionId)
      : undefined;

    log.info("[ensureManagedClient] rebuilding managed client", {
      sessionId: options.sessionId,
      projectPath,
      sandbox: options.sandboxEnabled,
      userId,
    });

    try {
      const result = await options.start(options.sessionId, projectPath, sessionPath, {
        forceNewProcess: false,
        userId,
      });
      log.info("[ensureManagedClient] rebuild complete", {
        sessionId: options.sessionId,
        status: result.status,
      });
    } catch (err: unknown) {
      log.error("[ensureManagedClient] rebuild failed", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    return options.getActiveManaged(options.sessionId);
  })();

  pendingEnsureOperations.set(options.sessionId, operationPromise);
  try {
    return await operationPromise;
  } finally {
    pendingEnsureOperations.delete(options.sessionId);
  }
}
