import { useSessionStore } from "../stores/use-session-store";
import { useSubagentStore } from "../stores/use-subagent-store";

export function resolveEffectiveSessionId(
  activeSessionId: string | null | undefined,
  activeSubsessionId: string | null | undefined,
): string | null {
  return activeSubsessionId ?? activeSessionId ?? null;
}

export function getEffectiveSessionId(): string | null {
  return resolveEffectiveSessionId(
    useSessionStore.getState().activeSessionId,
    useSubagentStore.getState().activeSubsessionId,
  );
}
