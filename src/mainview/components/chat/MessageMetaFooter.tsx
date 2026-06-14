import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../types";
import { formatTokenCount } from "../../utils/turn-utils";

function Tag({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-text-tertiary/10 font-mono">
      <span className={`text-text-tertiary ${color ?? ""}`}>{label}</span>
      <span className="text-text-secondary dark:text-text-tertiary">{value}</span>
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
    <div className="mt-1.5 pt-1.5 pl-2 pb-0.5 border-t border-border-secondary/20">
      <div className="flex items-center gap-1 text-[10px] flex-nowrap overflow-x-auto">
        <span className="inline-flex items-center gap-1 shrink-0">
          <Tag label={t("tokenInput")} value={formatTokenCount(tokenUsage.input)} />
          <Tag label={t("tokenOutput")} value={formatTokenCount(tokenUsage.output)} />
          <Tag
            label={t("tokenReasoning")}
            value={formatTokenCount(tokenUsage.reasoning ?? 0)}
            color="text-semantic-agent"
          />
          <Tag
            label={t("tokenCacheRead")}
            value={formatTokenCount(tokenUsage.cacheRead ?? 0)}
            color="text-status-success"
          />
          <Tag
            label={t("tokenCacheWrite")}
            value={formatTokenCount(tokenUsage.cacheWrite ?? 0)}
            color="text-semantic-memory"
          />
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-status-warning/10 text-status-warning font-mono">
            ${(tokenUsage.cost ?? 0).toFixed(5)}
          </span>
        </span>
        {modelLabel && <span className="text-text-tertiary shrink-0">{modelLabel}</span>}
      </div>
    </div>
  );
});
