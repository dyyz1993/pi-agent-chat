import { Loader2, Zap, Target, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTierStore, TIER_KEYS } from "../../stores/use-tier-store";
import type { TierKey } from "../../stores/use-tier-store";
import { useSessionStore } from "../../stores/use-session-store";

const ICONS: Record<TierKey, React.ComponentType<{ className?: string }>> = {
  fast: Zap,
  pro: Target,
  max: Brain,
};

export function TierSwitcher() {
  const { t } = useTranslation("chat");
  const currentTier = useTierStore((s) => s.currentTier);
  const switching = useTierStore((s) => s.switching);
  const switchToTier = useTierStore((s) => s.switchToTier);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  if (!activeSessionId) return null;

  const labels: Record<TierKey, string> = {
    fast: t("tierFast"),
    pro: t("tierPro"),
    max: t("tierMax"),
  };

  return (
    <div className="flex items-center gap-1 px-3 py-0.5">
      {TIER_KEYS.map((tier) => {
        const isActive = currentTier === tier;
        const Icon = ICONS[tier];
        const isSwitchingThis = switching && isActive;

        return (
          <button
            key={tier}
            onClick={() => {
              if (!switching && activeSessionId) {
                switchToTier(tier, activeSessionId);
              }
            }}
            disabled={switching || !activeSessionId}
            className={`
              flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-all duration-150
              ${
                isActive
                  ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-medium ring-1 ring-indigo-500/30"
                  : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={labels[tier]}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span>{labels[tier]}</span>
            {isSwitchingThis && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
