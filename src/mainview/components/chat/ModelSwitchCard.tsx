import { memo } from "react";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TIER_KEYS, useTierStore } from "../../stores/use-tier-store";
import { formatTime } from "./message-card-helpers";

export interface ModelSwitchData {
  provider: string;
  modelId: string;
  previousProvider?: string;
  previousModelId?: string;
  source?: string;
}

export function extractModelSwitchData(data: unknown): ModelSwitchData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const provider = typeof d.provider === "string" ? d.provider : undefined;
  const modelId = typeof d.modelId === "string" ? d.modelId : undefined;
  if (!provider || !modelId) return null;
  return {
    provider,
    modelId,
    previousProvider: typeof d.previousProvider === "string" ? d.previousProvider : undefined,
    previousModelId: typeof d.previousModelId === "string" ? d.previousModelId : undefined,
    source: typeof d.source === "string" ? d.source : undefined,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface ModelSwitchCardProps {
  data: ModelSwitchData;
  messageId: string;
  timestamp: number;
  sessionId: string | null;
}

/**
 * Compact centered notice rendered for `model_changed` session entries
 * (Plan A from docs/mockups/model-switch-entry.html): a pill showing
 * "previous model → new model (tier)" that stays out of the message
 * cards' way. Display-only — no collapse, selection, or checkbox.
 */
export const ModelSwitchCard = memo(function ModelSwitchCard({
  data,
  messageId,
  timestamp,
  sessionId,
}: ModelSwitchCardProps) {
  const { t } = useTranslation("chat");
  const tierModels = useTierStore((s) =>
    sessionId ? (s.dataBySession[sessionId]?.tierModels ?? s.globalDefaults) : s.globalDefaults,
  );

  const to = `${data.provider}/${data.modelId}`;
  const from =
    data.previousProvider && data.previousModelId
      ? `${data.previousProvider}/${data.previousModelId}`
      : null;
  const matchedTier = TIER_KEYS.find(
    (tier) => tierModels[tier]?.toLowerCase() === to.toLowerCase(),
  );
  const tierLabel = matchedTier
    ? `(${capitalize(matchedTier)})`
    : `(${t("modelSwitch.customTier", "自定义")})`;

  return (
    <div data-msg-card-id={messageId} className="flex justify-center py-0.5">
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border-primary bg-bg-secondary px-3 py-1 text-xs text-text-secondary">
        <ArrowLeftRight className="h-3 w-3 shrink-0 text-accent" aria-hidden />
        <span className="shrink-0 font-medium">{t("modelSwitch.label", "切换模型")}</span>
        {from && (
          <>
            <span
              className="truncate rounded border border-border-primary bg-bg-tertiary px-1.5 py-px font-mono text-[11px] text-text-secondary"
              title={from}
            >
              {from}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-text-tertiary" aria-hidden />
          </>
        )}
        <span
          className="truncate rounded bg-accent-muted px-1.5 py-px font-mono text-[11px] font-medium text-accent-text"
          title={to}
        >
          {to}
        </span>
        <span className="shrink-0 text-text-tertiary">{tierLabel}</span>
        <span className="shrink-0 text-[10px] text-text-tertiary">{formatTime(timestamp)}</span>
      </div>
    </div>
  );
});
