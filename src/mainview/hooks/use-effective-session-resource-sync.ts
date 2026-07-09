import { useEffect, useRef } from "react";
import { useEffectiveSessionId } from "./use-effective-session-id";
import { apiClient } from "../lib/api-client";
import { setupSubscriptions, requestRulesSnapshot } from "../stores/session-subscriptions";
import { useSessionStore } from "../stores/use-session-store";
import { useSubagentStore } from "../stores/use-subagent-store";
import type { SessionMeta, SubagentSessionInfo } from "../types";

type EffectiveSessionRuntimeTarget = Pick<
  SessionMeta,
  "sessionId" | "sessionPath" | "projectPath"
> & {
  forceNewProcess: boolean;
};

function findSessionMetaById(
  sessionsByProject: Record<string, SessionMeta[]>,
  sessionId: string | null,
): SessionMeta | null {
  if (!sessionId) return null;
  for (const sessions of Object.values(sessionsByProject)) {
    const found = sessions.find((session) => session.sessionId === sessionId);
    if (found) return found;
  }
  return null;
}

function findSubsessionInfo(
  subsessionsByParent: Record<string, SubagentSessionInfo[]>,
  sessionId: string | null,
): SubagentSessionInfo | null {
  if (!sessionId) return null;
  for (const subsessions of Object.values(subsessionsByParent)) {
    const found = subsessions.find((session) => session.sessionId === sessionId);
    if (found) return found;
  }
  return null;
}

function resolveRuntimeTarget(
  effectiveSessionId: string | null,
  activeSessionId: string | null,
): EffectiveSessionRuntimeTarget | null {
  if (!effectiveSessionId) return null;

  const sessionState = useSessionStore.getState();
  const listedSession = findSessionMetaById(sessionState.sessionsByProject, effectiveSessionId);
  if (listedSession?.sessionPath && listedSession.projectPath) {
    return {
      sessionId: listedSession.sessionId,
      sessionPath: listedSession.sessionPath,
      projectPath: listedSession.projectPath,
      forceNewProcess: listedSession.sessionId !== activeSessionId,
    };
  }

  const activeParent = findSessionMetaById(sessionState.sessionsByProject, activeSessionId);
  const sub = findSubsessionInfo(
    useSubagentStore.getState().subsessionsByParent,
    effectiveSessionId,
  );
  if (sub?.sessionPath && activeParent?.projectPath) {
    return {
      sessionId: sub.sessionId,
      sessionPath: sub.sessionPath,
      projectPath: activeParent.projectPath,
      forceNewProcess: true,
    };
  }

  return null;
}

async function ensureRuntime(target: EffectiveSessionRuntimeTarget): Promise<void> {
  const result = (await apiClient.call("agent.start", {
    sessionId: target.sessionId,
    projectPath: target.projectPath,
    sessionPath: target.sessionPath,
    forceNewProcess: target.forceNewProcess,
  })) as { status?: string };

  if (result.status !== "started" && result.status !== "already_running") return;

  useSessionStore.setState((state) => ({
    sessionReady: { ...state.sessionReady, [target.sessionId]: true },
    agentReady: { ...state.agentReady, [target.sessionId]: true },
  }));

  const sessionMeta: SessionMeta = {
    sessionId: target.sessionId,
    sessionPath: target.sessionPath,
    projectPath: target.projectPath,
    name: "",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 0,
    firstMessage: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "idle",
  };

  setupSubscriptions(
    useSessionStore.getState(),
    (fn) => useSessionStore.setState((state) => fn(state)),
    target.sessionId,
    findSessionMetaById(useSessionStore.getState().sessionsByProject, target.sessionId) ??
      sessionMeta,
  );
  requestRulesSnapshot(target.sessionId);
}

export function useEffectiveSessionResourceSync(): void {
  const effectiveSessionId = useEffectiveSessionId();
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSubsessionId = useSubagentStore((s) => s.activeSubsessionId);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const subsessionsByParent = useSubagentStore((s) => s.subsessionsByParent);
  const lastSyncedTargetKeyRef = useRef<string | null>(null);
  const lastFetchedResourceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!effectiveSessionId) return;
    const target = resolveRuntimeTarget(effectiveSessionId, activeSessionId);
    const targetKey = target
      ? `${target.sessionId}:${target.sessionPath}:${target.projectPath}:${target.forceNewProcess}`
      : null;
    const resourceKey = targetKey
      ? `${effectiveSessionId}:${targetKey}`
      : `${effectiveSessionId}:pending-target`;
    const fetchInitialStateOnce = () => {
      if (lastFetchedResourceKeyRef.current === resourceKey) return;
      lastFetchedResourceKeyRef.current = resourceKey;
      useSessionStore.getState().fetchInitialState(effectiveSessionId);
      void useSessionStore
        .getState()
        .fetchModelState(effectiveSessionId, { force: true, includeFavorites: false });
    };

    if (target && targetKey && lastSyncedTargetKeyRef.current !== targetKey) {
      lastSyncedTargetKeyRef.current = targetKey;
      void ensureRuntime(target)
        .catch(() => {})
        .finally(fetchInitialStateOnce);
      return;
    }

    fetchInitialStateOnce();
  }, [
    activeSessionId,
    activeSubsessionId,
    effectiveSessionId,
    sessionsByProject,
    subsessionsByParent,
  ]);
}
