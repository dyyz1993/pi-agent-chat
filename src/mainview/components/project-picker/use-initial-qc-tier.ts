import { useSessionStore } from "../../stores/use-session-store";
import { useTierStore, type TierKey } from "../../stores/use-tier-store";

export type QcTier = TierKey;

/**
 * Default tier for the Quick Create flow: reuse the active session's configured
 * tier so the model the user actually picked is used, instead of a hardcoded
 * "fast". Falls back to "fast" when no session is active or the session has
 * no configured tier. See issue #172.
 */
export function useInitialQcTier(): QcTier {
  const activeProjectPath = useSessionStore(
    (s) => s.projectTabs.find((tab) => tab.id === s.activeProjectId)?.path,
  );
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeTier = useTierStore((s) =>
    activeSessionId && activeProjectPath
      ? s.getCurrentTierForSession(activeSessionId, activeProjectPath)
      : null,
  );
  return activeTier ?? "fast";
}
