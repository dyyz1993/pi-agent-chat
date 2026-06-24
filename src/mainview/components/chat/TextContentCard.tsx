import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";

import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import { ContextReferenceCard, extractContextReferenceSegments } from "./ContextReferenceCard";
import { CopyButton } from "./CopyButton";
import { HookInterventionCard, extractHookInterventionSegments } from "./HookInterventionCard";

function isLongContent(text: string): boolean {
  const lineCount = text.split("\n").length;
  return lineCount > 20;
}

export const TextContentCard = memo(function TextContentCard({
  text,
  isStreaming,
  blockId,
}: {
  text: string;
  isStreaming?: boolean;
  blockId: string;
}) {
  const { t } = useTranslation("chat");
  const openExpand = useChatOverlayStore((s) => s.openMarkdown);
  const segments = extractContextReferenceSegments(text).flatMap((segment) => {
    if (segment.type !== "text") return [segment];
    return extractHookInterventionSegments(segment.text) ?? [segment];
  });
  const hasInternalReferences = segments.some((segment) => segment.type !== "text");
  const visibleText = hasInternalReferences
    ? segments
        .filter(
          (segment): segment is Extract<(typeof segments)[number], { type: "text" }> =>
            segment.type === "text",
        )
        .map((segment) => segment.text)
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : text;

  if (isStreaming) {
    return (
      <div
        data-block-id={blockId}
        className="my-0.5 group relative px-3 pr-10 text-sm text-text-primary whitespace-pre-wrap break-words"
      >
        <div className="absolute top-2 right-2 z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <CopyButton text={visibleText} size="xs" />
        </div>
        {segments.map((segment, index) =>
          segment.type === "references" ? (
            <ContextReferenceCard key={`ref-${index}`} references={segment.references} />
          ) : segment.type === "hook" ? (
            <HookInterventionCard key={`hook-${index}`} intervention={segment.intervention} />
          ) : (
            <span key={`text-${index}`}>{segment.text}</span>
          ),
        )}
      </div>
    );
  }

  const shouldShowExpand = isLongContent(visibleText);

  return (
    <div
      data-block-id={blockId}
      className="my-0.5 group relative px-3 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-transparent prose-hr:my-0.5"
    >
      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {shouldShowExpand && (
          <button
            onClick={() =>
              openExpand(
                t("messageContentLineCount", { count: visibleText.split("\n").length }),
                visibleText,
              )
            }
            className="p-1 rounded text-text-tertiary hover:text-semantic-accent hover:bg-surface-hover/60 dark:hover:bg-surface-dim/60 transition-colors"
            title={t("expandFullText")}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
        <CopyButton text={visibleText} size="xs" />
      </div>
      {segments.map((segment, index) =>
        segment.type === "references" ? (
          <ContextReferenceCard key={`ref-${index}`} references={segment.references} />
        ) : segment.type === "hook" ? (
          <HookInterventionCard key={`hook-${index}`} intervention={segment.intervention} />
        ) : (
          <CachedReactMarkdown key={`text-${index}`}>{segment.text}</CachedReactMarkdown>
        ),
      )}
    </div>
  );
});
