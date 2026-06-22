export type DelegateChildMap = Map<string, Set<string>>;

export interface SyncDelegateResult {
  sessionId: string;
  status: string;
  exitCode: number;
  finalText: string;
  error?: string;
}

export interface SyncDelegateResolver {
  resolve: (value: SyncDelegateResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  parentSessionId: string;
}

export interface SyncChildRegistry {
  delete(sessionId: string): boolean;
}

export interface DelegateClientInfo {
  info: {
    status: string;
    projectPath: string;
  };
}

export interface DelegateSessionList {
  sessions: Array<{ sessionId: string; status: string; projectPath: string }>;
}

export function registerDelegateChild(
  parentChildMap: DelegateChildMap,
  parentSessionId: string,
  childSessionId: string,
): void {
  let children = parentChildMap.get(parentSessionId);
  if (!children) {
    children = new Set<string>();
    parentChildMap.set(parentSessionId, children);
  }
  children.add(childSessionId);
}

export function findParentSession(
  parentChildMap: DelegateChildMap,
  childSessionId: string,
): string | null {
  for (const [parentId, children] of parentChildMap.entries()) {
    if (children.has(childSessionId)) return parentId;
  }
  return null;
}

export function removeDelegateChild(
  parentChildMap: DelegateChildMap,
  parentSessionId: string,
  childSessionId: string,
): boolean {
  const children = parentChildMap.get(parentSessionId);
  if (!children) return false;
  const removed = children.delete(childSessionId);
  if (children.size === 0) parentChildMap.delete(parentSessionId);
  return removed;
}

export function removeSessionFromAllParents(
  parentChildMap: DelegateChildMap,
  sessionId: string,
): void {
  for (const [parentId, childSet] of parentChildMap) {
    childSet.delete(sessionId);
    if (childSet.size === 0) parentChildMap.delete(parentId);
  }
}

export function popDelegateChildren(
  parentChildMap: DelegateChildMap,
  parentSessionId: string,
): string[] {
  const children = parentChildMap.get(parentSessionId);
  if (!children) return [];
  parentChildMap.delete(parentSessionId);
  return [...children];
}

export function clearDelegateTracking(
  delegateCreatedAt: Map<string, number>,
  delegateReplyCount: Map<string, number>,
  sessionId: string,
  delegateRepliedSessions?: Set<string>,
): boolean {
  const hadCreatedAt = delegateCreatedAt.delete(sessionId);
  const hadReplyCount = delegateReplyCount.delete(sessionId);
  const hadReplied = delegateRepliedSessions?.delete(sessionId) ?? false;
  return hadCreatedAt || hadReplyCount || hadReplied;
}

export function cleanupStoppedDelegateSession(options: {
  sessionId: string;
  parentChildMap: DelegateChildMap;
  delegateCreatedAt: Map<string, number>;
  delegateReplyCount: Map<string, number>;
  delegateRepliedSessions?: Set<string>;
  syncDelegateResolvers: Map<string, SyncDelegateResolver>;
  subagentSyncChildren: SyncChildRegistry;
  syncDelegateLastText: Map<string, string>;
}): { childSessionIds: string[]; resolvedSyncDelegate: boolean } {
  const childSessionIds = popDelegateChildren(options.parentChildMap, options.sessionId);
  removeSessionFromAllParents(options.parentChildMap, options.sessionId);
  clearDelegateTracking(
    options.delegateCreatedAt,
    options.delegateReplyCount,
    options.sessionId,
    options.delegateRepliedSessions,
  );

  const syncResolver = options.syncDelegateResolvers.get(options.sessionId);
  if (!syncResolver) {
    return { childSessionIds, resolvedSyncDelegate: false };
  }

  clearTimeout(syncResolver.timeout);
  options.syncDelegateResolvers.delete(options.sessionId);
  options.subagentSyncChildren.delete(options.sessionId);
  options.syncDelegateLastText.delete(options.sessionId);
  syncResolver.resolve({
    sessionId: options.sessionId,
    status: "aborted",
    exitCode: 1,
    finalText: "(stopped)",
  });

  return { childSessionIds, resolvedSyncDelegate: true };
}

export function listDelegateChildSessions<TClient extends DelegateClientInfo>(
  parentChildMap: DelegateChildMap,
  clients: Map<string, TClient>,
  parentSessionId: string,
): DelegateSessionList {
  const children = parentChildMap.get(parentSessionId);
  if (!children) return { sessions: [] };

  const sessions: DelegateSessionList["sessions"] = [];
  for (const childId of children) {
    const managed = clients.get(childId);
    if (managed) {
      sessions.push({
        sessionId: childId,
        status: managed.info.status,
        projectPath: managed.info.projectPath,
      });
    }
  }
  return { sessions };
}

export function canStopDelegateChild(
  parentChildMap: DelegateChildMap,
  parentSessionId: string,
  childSessionId: string,
): boolean {
  return parentChildMap.get(parentSessionId)?.has(childSessionId) ?? false;
}

export function canManageDelegateChild(
  parentChildMap: DelegateChildMap,
  parentSessionId: string,
  childSessionId: string,
): boolean {
  return parentChildMap.get(parentSessionId)?.has(childSessionId) ?? false;
}

export function canSendDelegateMessage(
  parentChildMap: DelegateChildMap,
  sourceSessionId: string,
  targetSessionId: string,
): boolean {
  if (sourceSessionId === targetSessionId) return true;
  if (parentChildMap.get(sourceSessionId)?.has(targetSessionId)) return true;
  return findParentSession(parentChildMap, sourceSessionId) === targetSessionId;
}
