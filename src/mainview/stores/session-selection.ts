import type { SessionMeta } from "../types";

export function pickDefaultSessionId(
  sessions: SessionMeta[],
  lastSessionId?: string | null,
): string | null {
  if (sessions.length === 0) return null;

  if (lastSessionId) {
    const last = sessions.find((session) => session.sessionId === lastSessionId);
    if (last && !last.delegateParentSessionId) {
      return last.sessionId;
    }
  }

  return (
    sessions.find((session) => !session.delegateParentSessionId)?.sessionId ??
    sessions[0]?.sessionId ??
    null
  );
}
