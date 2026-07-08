import { ChevronDown, ChevronUp, FileText, MessageSquare, MessageSquareQuote, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useComposerPlaceholderStore } from "../../stores/use-composer-placeholder-store";

function getTextStats(text: string, charsLabel: string, linesLabel: string): string {
  const lines = text.split(/\r?\n/u).length;
  const chars = text.length;
  return `${chars} ${charsLabel} · ${lines} ${linesLabel}`;
}

export function ComposerPlaceholderBar() {
  const { t } = useTranslation("chat");
  const placeholders = useComposerPlaceholderStore((s) => s.placeholders);
  const removePlaceholder = useComposerPlaceholderStore((s) => s.removePlaceholder);
  const togglePlaceholder = useComposerPlaceholderStore((s) => s.togglePlaceholder);

  if (placeholders.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-border-primary/70 px-2.5 py-2"
      data-testid="composer-placeholder-bar"
    >
      {placeholders.map((placeholder) => (
        <div
          key={placeholder.id}
          className="group min-w-0 overflow-hidden rounded-xl border border-border-primary/80 bg-bg-secondary/80 text-xs shadow-sm"
          data-testid="composer-placeholder"
        >
          <div className="flex min-h-8 max-w-full items-center gap-1.5 px-2">
            {placeholder.type === "sessionRef" ? (
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-accent" />
            ) : placeholder.type === "longContent" ? (
              <FileText className="h-3.5 w-3.5 shrink-0 text-status-info" />
            ) : (
              <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
            )}
            <button
              type="button"
              onClick={() => togglePlaceholder(placeholder.id)}
              className="flex min-w-0 items-center gap-1.5 text-left"
              aria-expanded={placeholder.expanded}
              aria-label={
                placeholder.expanded ? t("composerQuoteCollapse") : t("composerQuoteExpand")
              }
            >
              <span className="shrink-0 font-medium text-text-primary">
                {placeholder.type === "sessionRef"
                  ? t("composerSession")
                  : placeholder.type === "longContent"
                    ? t("longContent.title")
                    : t("composerQuote")}
              </span>
              <span className="max-w-52 truncate text-text-secondary">{placeholder.title}</span>
              <span className="shrink-0 text-[11px] text-text-tertiary">
                {placeholder.type === "sessionRef"
                  ? (placeholder.description ?? placeholder.text)
                  : getTextStats(
                      placeholder.text,
                      t("composerQuoteChars"),
                      t("composerQuoteLines"),
                    )}
              </span>
              {placeholder.expanded ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              )}
            </button>
            <button
              type="button"
              onClick={() => removePlaceholder(placeholder.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary"
              aria-label={t("composerQuoteRemove")}
              title={t("composerQuoteRemove")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {placeholder.expanded && (
            <pre className="max-h-40 max-w-[min(34rem,calc(100vw-5rem))] overflow-auto border-t border-border-primary/70 bg-bg-primary/60 px-3 py-2 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap">
              {placeholder.text}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
