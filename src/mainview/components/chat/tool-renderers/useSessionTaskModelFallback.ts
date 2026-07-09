import { useMemo } from "react";
import { useSessionStore } from "../../../stores/use-session-store";
import { useTierStore } from "../../../stores/use-tier-store";
import type { SessionTaskModelInfo } from "./SessionTaskModelBadges";

export function useSessionTaskModelFallback(): SessionTaskModelInfo {
  const activeProjectPath = useSessionStore(
    (s) => s.projectTabs.find((tab) => tab.id === s.activeProjectId)?.path,
  );
  const currentModel = useSessionStore((s) => s.currentModel);
  const currentThinkingLevel = useSessionStore((s) => s.currentThinkingLevel);
  const currentTier = useTierStore((s) =>
    activeProjectPath ? s.getCurrentTier(activeProjectPath) : null,
  );

  return useMemo(
    () => ({
      tier: currentTier,
      model: currentModel?.id,
      provider: currentModel?.provider,
      thinkingLevel: currentModel?.reasoning ? currentThinkingLevel : undefined,
    }),
    [
      currentModel?.id,
      currentModel?.provider,
      currentModel?.reasoning,
      currentThinkingLevel,
      currentTier,
    ],
  );
}
