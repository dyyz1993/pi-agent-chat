import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

type TokenTagTone = "neutral" | "reasoning" | "cacheRead" | "cacheWrite";

const TOKEN_TAG_TONES: Record<TokenTagTone, { chip: string; value: string }> = {
  neutral: {
    chip: "bg-text-tertiary/10 text-text-tertiary",
    value: "text-text-secondary dark:text-text-tertiary",
  },
  reasoning: {
    chip: "bg-semantic-agent/10 text-semantic-agent ring-1 ring-inset ring-semantic-agent/20",
    value: "text-current/80",
  },
  cacheRead: {
    chip: "bg-status-success/10 text-status-success ring-1 ring-inset ring-status-success/20",
    value: "text-current/80",
  },
  cacheWrite: {
    chip: "bg-semantic-memory/10 text-semantic-memory ring-1 ring-inset ring-semantic-memory/20",
    value: "text-current/80",
  },
};

function Tag({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: TokenTagTone;
}) {
  const toneClasses = TOKEN_TAG_TONES[tone];

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono whitespace-nowrap ${toneClasses.chip}`}
    >
      <span>{label}</span>
      <span className={toneClasses.value}>{value}</span>
    </span>
  );
}

export const MessageMetaFooter = memo(function MessageMetaFooter({
  message,
}: {
  message: ChatMessage;
}) {
  const { t } = useTranslation("chat");
  const { tokenUsage, model, provider } = message;

  if (!tokenUsage) return null;

  const modelLabel = provider && model ? `${provider}/${model}` : (model ?? provider ?? "");

  return (
    <div className="mt-0.5 pt-1 pl-2 pb-0.5 border-t border-border-secondary/20">
      <div className="flex items-center gap-1 text-[10px] flex-nowrap overflow-x-auto">
        <span className="inline-flex items-center gap-1 shrink-0">
          <Tag label={t("tokenInput")} value={formatTokenCount(tokenUsage.input)} />
          <Tag label={t("tokenOutput")} value={formatTokenCount(tokenUsage.output)} />
          <Tag
            label={t("tokenReasoning")}
            value={formatTokenCount(tokenUsage.reasoning ?? 0)}
            tone="reasoning"
          />
          <Tag
            label={t("tokenCacheRead")}
            value={formatTokenCount(tokenUsage.cacheRead ?? 0)}
            tone="cacheRead"
          />
          <Tag
            label={t("tokenCacheWrite")}
            value={formatTokenCount(tokenUsage.cacheWrite ?? 0)}
            tone="cacheWrite"
          />
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning ring-1 ring-inset ring-status-warning/20 font-mono whitespace-nowrap">
            ${(tokenUsage.cost ?? 0).toFixed(5)}
          </span>
        </span>
        {modelLabel && <span className="text-text-tertiary shrink-0">{modelLabel}</span>}
      </div>
    </div>
  );
});
