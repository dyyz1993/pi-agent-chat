import { useCallback } from "react";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSessionReturnStore } from "../../../stores/use-session-return-store";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import type { SessionMeta } from "../../../types";

async function openSubagentTargetSession(
  session: SessionMeta,
  state: ReturnType<typeof useSessionStore.getState>,
  activeProjectId: string | null,
  options?: { returnSourceSessionId?: string | null },
): Promise<boolean> {
  if (session.delegateType !== "subagent" || !session.delegateParentSessionId) return false;

  const parentSessionId = session.delegateParentSessionId;
  let parentSession: SessionMeta | undefined;
  let parentTabId: string | null = null;

  for (const tab of state.projectTabs) {
    const sessions = state.sessionsByProject[tab.path];
    const found = sessions?.find((item) => item.sessionId === parentSessionId);
    if (found) {
      parentSession = found;
      parentTabId = tab.id;
      break;
    }
  }

  if (!parentSession) {
    for (const tab of state.projectTabs) {
      try {
        const sessions = await state.loadSessionsForProject(tab.path);
        const found = sessions?.find((item) => item.sessionId === parentSessionId);
        if (found) {
          parentSession = found;
          parentTabId = tab.id;
          break;
        }
      } catch {
        continue;
      }
    }
  }

  if (!parentSession || !parentTabId) return false;

  const returnSourceSessionId = options?.returnSourceSessionId ?? null;
  if (returnSourceSessionId && returnSourceSessionId !== parentSession.sessionId) {
    useSessionReturnStore.getState().setReturnSource(parentSession.sessionId, returnSourceSessionId);
  }

  if (parentTabId !== activeProjectId) {
    state.setActiveProject(parentTabId, { skipAutoSession: true });
  }

  state.setActiveSession(parentSession.sessionId, true);
  await useSubagentStore.getState().loadSubsessions(parentSession.sessionPath);
  useSubagentStore.getState().setActiveSubsession(parentSession.sessionId, session.sessionId);
  return true;
}

export async function jumpToSessionById(
  sessionId: string | undefined,
  options?: { returnSourceSessionId?: string | null },
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
