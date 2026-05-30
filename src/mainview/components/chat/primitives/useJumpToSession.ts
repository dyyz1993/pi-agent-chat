import { useCallback } from "react";
import { useSessionStore } from "../../../stores/use-session-store";

export function useJumpToSession(sessionId: string | undefined): {
  canJump: boolean;
  handleJump: () => void;
} {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const canJump = !!sessionId && sessionId !== activeSessionId;

  const handleJump = useCallback(async () => {
    if (!sessionId) return;

    const state = useSessionStore.getState();
    const { sessionsByProject, projectTabs, activeProjectId } = state;

    for (const tab of projectTabs) {
      const sessions = sessionsByProject[tab.path];
      const found = sessions?.find((s) => s.sessionId === sessionId);
      if (found) {
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

    state.setActiveSession(sessionId, true);
  }, [sessionId]);

  return { canJump, handleJump };
}
