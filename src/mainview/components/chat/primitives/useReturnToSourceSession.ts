import { useCallback, useEffect, useMemo } from "react";
import { useSessionStore } from "../../../stores/use-session-store";
import { useSessionReturnStore } from "../../../stores/use-session-return-store";
import { useSubagentStore } from "../../../stores/use-subagent-store";
import { jumpToSessionById } from "./useJumpToSession";
import type { SessionMeta } from "../../../types";

export type ReturnSourceKind = "subagent" | "delegate" | "source";

export interface ReturnSourceTarget {
  kind: ReturnSourceKind;
  targetSessionId: string;
  handleReturn: () => void;
}

function findSessionMeta(
  sessionsByProject: Record<string, SessionMeta[]>,
  sessionId: string | null,
): SessionMeta | null {
  if (!sessionId) return null;
  for (const sessions of Object.values(sessionsByProject)) {
    const match = sessions.find((session) => session.sessionId === sessionId);
    if (match) return match;
  }
  return null;
}

export function useReturnToSourceSession(): ReturnSourceTarget | null {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const fallbackSourceId = useSessionReturnStore((s) =>
    activeSessionId && s.activeReturnTargetId === activeSessionId
      ? s.returnSourceBySession[activeSessionId]
      : undefined,
  );

  useEffect(() => {
    useSessionReturnStore.getState().clearInactiveReturnSource(activeSessionId);
  }, [activeSessionId]);

  const target = useMemo<Omit<ReturnSourceTarget, "handleReturn"> | null>(() => {
    if (activeSubId && activeSessionId) {
      return { kind: "subagent", targetSessionId: activeSessionId };
    }

    const activeSession = findSessionMeta(sessionsByProject, activeSessionId);
    const delegateSourceId = activeSession?.delegateParentSessionId ?? null;
    const targetSessionId = delegateSourceId ?? fallbackSourceId;
    if (!activeSessionId || !targetSessionId || targetSessionId === activeSessionId) {
      return null;
    }

    const isSubagentSession = activeSession?.delegateType === "subagent";
    return {
      kind: isSubagentSession ? "subagent" : delegateSourceId ? "delegate" : "source",
      targetSessionId,
    };
  }, [activeSessionId, activeSubId, fallbackSourceId, sessionsByProject]);

  const handleReturn = useCallback(() => {
    if (!target) return;
    if (target.kind === "subagent" && activeSessionId) {
      useSubagentStore.getState().setActiveSubsession(activeSessionId, null);
      return;
    }
    if (activeSessionId) {
      useSessionReturnStore.getState().clearReturnSource(activeSessionId);
    }
    void jumpToSessionById(target.targetSessionId);
  }, [activeSessionId, target]);

  if (!target) return null;
  return { ...target, handleReturn };
}
