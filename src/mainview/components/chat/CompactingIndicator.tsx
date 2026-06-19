import { memo } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CHAT_CARD_HEADER_BASE_CLASS,
  CHAT_CARD_INTERACTIVE_SHELL_CLASS,
} from "./chat-layout-classes";

/**
 * Purple placeholder row shown at the bottom of the message list while
 * the session is in "compacting" state (passive/threshold compaction).
 *
 * Not a real message — purely UI-driven by sessionStatus === "compacting".
 * Disappears when compaction_end triggers a force reload, at which point
 * the persistent compactionSummary card takes its place.
 */
export const CompactingIndicator = memo(function CompactingIndicator() {
  const { t } = useTranslation("chat");

  return (
    <div
      data-msg-card-id="__compacting__"
      className={`${CHAT_CARD_INTERACTIVE_SHELL_CLASS} bg-semantic-agent/[0.04]`}
    >
      <div className={`${CHAT_CARD_HEADER_BASE_CLASS} border-l-semantic-agent/50`}>
        <span className="flex items-center gap-1 text-[11px] font-medium text-semantic-agent/80">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t("compacting")}
        </span>
      </div>
      <div className="relative z-20 px-3 py-1 text-xs text-text-tertiary italic leading-relaxed border-l-[3px] border-l-semantic-agent/50">
        {t("compactingHint")}
      </div>
    </div>
  );
});
