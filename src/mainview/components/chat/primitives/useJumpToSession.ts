import { useCallback } from "react";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSessionReturnStore } from "../../../stores/use-session-return-store";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import type { SessionMeta } from "../../../types";

interface JumpToSessionOptions {
  returnSourceSessionId?: string | null;
  subagentParentSessionId?: string | null;
}

async function findSessionAcrossProjects(
  sessionId: string,
  state: ReturnType<typeof useSessionStore.getState>,
): Promise<{ session: SessionMeta; tabId: string } | null> {
  for (const tab of state.projectTabs) {
    const sessions = state.sessionsByProject[tab.path];
    const found = sessions?.find((item) => item.sessionId === sessionId);
    if (found) {
      return { session: found, tabId: tab.id };
    }
  }

  for (const tab of state.projectTabs) {
    try {
      const sessions = await state.loadSessionsForProject(tab.path);
      const found = sessions?.find((item) => item.sessionId === sessionId);
      if (found) {
        return { session: found, tabId: tab.id };
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function openSubagentByParentSessionId(
  parentSessionId: string,
  subSessionId: string,
  state: ReturnType<typeof useSessionStore.getState>,
  activeProjectId: string | null,
  options?: JumpToSessionOptions,
): Promise<boolean> {
  const parentMatch = await findSessionAcrossProjects(parentSessionId, state);
  if (!parentMatch) return false;

  const { session: parentSession, tabId: parentTabId } = parentMatch;

  const returnSourceSessionId = options?.returnSourceSessionId ?? null;
  if (returnSourceSessionId && returnSourceSessionId !== parentSession.sessionId) {
    useSessionReturnStore
      .getState()
      .setReturnSource(parentSession.sessionId, returnSourceSessionId);
  }

  if (parentTabId !== activeProjectId) {
    state.setActiveProject(parentTabId, { skipAutoSession: true });
  }

  state.setActiveSession(parentSession.sessionId, true);
  await useSubagentStore.getState().loadSubsessions(parentSession.sessionPath);
  useSubagentStore.getState().setActiveSubsession(parentSession.sessionId, subSessionId);
  return true;
}

async function openSubagentTargetSession(
  session: SessionMeta,
  state: ReturnType<typeof useSessionStore.getState>,
  activeProjectId: string | null,
  options?: JumpToSessionOptions,
): Promise<boolean> {
  if (session.delegateType !== "subagent" || !session.delegateParentSessionId) return false;

  return openSubagentByParentSessionId(
    session.delegateParentSessionId,
    session.sessionId,
    state,
    activeProjectId,
    options,
  );
}

export async function jumpToSessionById(
  sessionId: string | undefined,
  options?: JumpToSessionOptions,
): Promise<void> {
  if (!sessionId) return;

  const activeSubId = useSubagentStore.getState().activeSubsessionId;
  const activeMainId = useSessionStore.getState().activeSessionId;
  if (activeSubId) {
    useSubagentStore.getState().setActiveSubsession(activeMainId ?? sessionId, null);
  }

  const state = useSessionStore.getState();
  const { sessionsByProject, projectTabs, activeProjectId } = state;

  for (const tab of projectTabs) {
    const sessions = sessionsByProject[tab.path];
    const found = sessions?.find((s) => s.sessionId === sessionId);
    if (found) {
      if (await openSubagentTargetSession(found, state, activeProjectId, options)) {
        return;
      }
      const returnSourceSessionId = options?.returnSourceSessionId ?? null;
      if (returnSourceSessionId && returnSourceSessionId !== sessionId) {
        useSessionReturnStore.getState().setReturnSource(sessionId, returnSourceSessionId);
      }
      if (tab.id !== activeProjectId) {
        state.setActiveProject(tab.id, { skipAutoSession: true });
      }
      state.setActiveSession(sessionId, true);
      return;
    }
  }

  for (const tab of projectTabs) {
    try {
      const sessions = await state.loadSessionsForProject(tab.path);
      const found = sessions?.find((s) => s.sessionId === sessionId);
      if (found) {
        if (await openSubagentTargetSession(found, state, activeProjectId, options)) {
          return;
        }
        const returnSourceSessionId = options?.returnSourceSessionId ?? null;
        if (returnSourceSessionId && returnSourceSessionId !== sessionId) {
          useSessionReturnStore.getState().setReturnSource(sessionId, returnSourceSessionId);
        }
        if (tab.id !== activeProjectId) {
          state.setActiveProject(tab.id, { skipAutoSession: true });
        }
        state.setActiveSession(sessionId, true);
        return;
      }
    } catch {
      continue;
    }
  }

  const subagentParentSessionId = options?.subagentParentSessionId ?? null;
  if (
    subagentParentSessionId &&
    (await openSubagentByParentSessionId(
      subagentParentSessionId,
      sessionId,
      state,
      activeProjectId,
      options,
    ))
  ) {
    return;
  }

  const returnSourceSessionId = options?.returnSourceSessionId ?? null;
  if (returnSourceSessionId && returnSourceSessionId !== sessionId) {
    useSessionReturnStore.getState().setReturnSource(sessionId, returnSourceSessionId);
  }
  state.setActiveSession(sessionId, true);
}

export function useJumpToSession(sessionId: string | undefined): {
  canJump: boolean;
  handleJump: () => void;
} {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const canJump = !!sessionId && sessionId !== activeSessionId;

  const handleJump = useCallback(async () => {
    await jumpToSessionById(sessionId, { returnSourceSessionId: activeSessionId });
  }, [activeSessionId, sessionId]);

  return { canJump, handleJump };
}
