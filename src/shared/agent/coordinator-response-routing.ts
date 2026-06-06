export interface CoordinatorResponseManaged {
  _activeSessionId: string;
}

export interface CoordinatorResponseRoute<TManaged extends CoordinatorResponseManaged> {
  managed: TManaged | undefined;
  matchedViaFallback: boolean;
  projectPath: string | undefined;
  processCount: number | undefined;
}

export function findCoordinatorResponseManaged<
  TManaged extends CoordinatorResponseManaged,
>(options: {
  active: TManaged | undefined;
  sessionId: string;
  sessionProjectPaths: Map<string, string>;
  processByCwd: Map<string, Set<TManaged>>;
}): CoordinatorResponseRoute<TManaged> {
  if (options.active) {
    return {
      managed: options.active,
      matchedViaFallback: false,
      projectPath: undefined,
      processCount: undefined,
    };
  }

  const projectPath = options.sessionProjectPaths.get(options.sessionId) ?? undefined;
  if (!projectPath) {
    return {
      managed: undefined,
      matchedViaFallback: false,
      projectPath: undefined,
      processCount: undefined,
    };
  }

  const procSet = options.processByCwd.get(projectPath);
  if (procSet) {
    for (const managed of procSet) {
      if (managed._activeSessionId === options.sessionId) {
        return {
          managed,
          matchedViaFallback: true,
          projectPath,
          processCount: procSet.size,
        };
      }
    }
  }

  return {
    managed: undefined,
    matchedViaFallback: false,
    projectPath,
    processCount: procSet?.size ?? 0,
  };
}
