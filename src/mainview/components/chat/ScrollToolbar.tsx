import { memo } from "react";
import { ChevronUp, ChevronDown, Loader2, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ScrollToolbarProps {
  isAtTop: boolean;
  isAtBottom: boolean;
  autoScrollEnabled: boolean;
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
  onToggleAutoScroll: () => void;
  isSeekingTop?: boolean;
}

export const ScrollToolbar = memo(function ScrollToolbar({
  isAtTop,
  isAtBottom,
  autoScrollEnabled,
  onScrollToTop,
  onScrollToBottom,
  onToggleAutoScroll,
  isSeekingTop = false,
}: ScrollToolbarProps) {
  const { t } = useTranslation("chat");
  const showNavButtons = !isAtTop || !isAtBottom;

  return (
    <div className="absolute bottom-3 right-2.5 flex flex-col gap-1.5 z-10">
      <button
        onClick={onToggleAutoScroll}
        className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
          autoScrollEnabled
            ? "border-accent/40 text-accent hover:text-accent hover:border-accent/50"
            : "border-border-secondary/30 text-text-tertiary hover:text-text-primary hover:border-border-secondary/40"
        }`}
        title={autoScrollEnabled ? t("scroll.stopAutoScroll") : t("scroll.startAutoScroll")}
        aria-label={autoScrollEnabled ? t("scroll.stopAutoScroll") : t("scroll.startAutoScroll")}
      >
        {autoScrollEnabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      {showNavButtons && (
        <div className="flex flex-col gap-1">
          {(!isAtTop || isSeekingTop) && (
            <button
              onClick={onScrollToTop}
              disabled={isSeekingTop}
              className="w-9 h-9 rounded-full border border-border-secondary/30 text-text-tertiary hover:text-accent hover:border-accent/40 flex items-center justify-center transition-colors"
              title={t("scroll.scrollToTop")}
              aria-label={t("scroll.scrollToTop")}
            >
              {isSeekingTop ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </button>
          )}
          {!isAtBottom && (
            <button
              data-testid="scroll-to-bottom-btn"
              onClick={onScrollToBottom}
              className="w-9 h-9 rounded-full border border-border-secondary/30 text-text-tertiary hover:text-accent hover:border-accent/40 flex items-center justify-center transition-colors"
              title={t("scroll.scrollToBottom")}
              aria-label={t("scroll.scrollToBottom")}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
