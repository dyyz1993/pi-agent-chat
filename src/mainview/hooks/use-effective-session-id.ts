import { resolveEffectiveSessionId } from "../lib/effective-session";
import { useSessionStore } from "../stores/use-session-store";
import { useSubagentStore } from "../stores/use-subagent-store";

export function useEffectiveSessionId(): string | null {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSubsessionId = useSubagentStore((s) => s.activeSubsessionId);
  return resolveEffectiveSessionId(activeSessionId, activeSubsessionId);
}
