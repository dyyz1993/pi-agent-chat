export type DelegateChildMap = Map<string, Set<string>>;

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
): boolean {
  const hadCreatedAt = delegateCreatedAt.delete(sessionId);
  const hadReplyCount = delegateReplyCount.delete(sessionId);
  return hadCreatedAt || hadReplyCount;
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
