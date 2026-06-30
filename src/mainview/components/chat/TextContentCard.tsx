import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2 } from "lucide-react";

import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import {
  ContextReferenceCard,
  extractContextReferenceSegments,
  type ContextReference,
} from "./ContextReferenceCard";
import { CopyButton } from "./CopyButton";
import {
  HookInterventionCard,
  extractHookInterventionSegments,
  type HookIntervention,
} from "./HookInterventionCard";
import StreamingMarkdownContent from "./StreamingMarkdownContent";
import { getRegisteredTags, getRenderer, type SpecialBlock } from "./special-block-registry";
import { hasSpecialBlocks, parseSpecialBlocks } from "./special-block-parser";
import "./special-block-renderers";

/** A flattened text/hook/references segment used for rendering. */
type RenderSegment =
  | { type: "text"; text: string }
  | { type: "references"; references: ContextReference[] }
  | { type: "hook"; intervention: HookIntervention }
  | { type: "special-block"; block: SpecialBlock };

function extractSpecialBlockSegments(
  text: string,
): Array<{ type: "text"; text: string } | { type: "special-block"; block: SpecialBlock }> | null {
  const tags = getRegisteredTags();
  if (!hasSpecialBlocks(text, tags)) return null;
  return parseSpecialBlocks(text, tags).map((segment) =>
    segment.type === "special-block"
      ? { type: "special-block", block: segment }
      : { type: "text", text: segment.text },
  );
}

function buildRenderSegments(text: string): RenderSegment[] {
  const refSegments = extractContextReferenceSegments(text);
  const result: RenderSegment[] = [];
  for (const seg of refSegments) {
    if (seg.type === "references") {
      result.push({ type: "references", references: seg.references });
      continue;
    }
    const sub = extractHookInterventionSegments(seg.text);
    if (sub) {
      for (const s of sub) result.push(s);
      continue;
    }
    const special = extractSpecialBlockSegments(seg.text);
    if (special) {
      for (const s of special) result.push(s);
    } else {
      result.push({ type: "text", text: seg.text });
    }
  }
  return result;
}

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
  const segments = buildRenderSegments(text);
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
        className="my-0.5 group relative px-3 pr-10 text-sm text-text-primary break-words select-text"
      >
        <div className="absolute top-2 right-2 z-10 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <CopyButton text={visibleText} size="xs" />
        </div>
        {!hasInternalReferences && visibleText.trim() ? (
          <div className="prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-transparent prose-hr:my-0.5">
            <StreamingMarkdownContent text={visibleText} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap">
            {segments.map((segment, index) =>
              segment.type === "references" ? (
                <ContextReferenceCard key={`ref-${index}`} references={segment.references} />
              ) : segment.type === "hook" ? (
                <HookInterventionCard key={`hook-${index}`} intervention={segment.intervention} />
              ) : segment.type === "special-block" ? (
                (() => {
                  const Renderer = getRenderer(segment.block.tag);
                  return Renderer ? (
                    <Renderer key={`special-${index}`} block={segment.block} />
                  ) : null;
                })()
              ) : (
                <span key={`text-${index}`}>{segment.text}</span>
              ),
            )}
          </div>
        )}
      </div>
    );
  }

  const shouldShowExpand = isLongContent(visibleText);

  return (
    <div
      data-block-id={blockId}
      className="my-0.5 group relative px-3 prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:bg-transparent prose-hr:my-0.5 select-text"
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
        ) : segment.type === "special-block" ? (
          (() => {
            const Renderer = getRenderer(segment.block.tag);
            return Renderer ? <Renderer key={`special-${index}`} block={segment.block} /> : null;
          })()
        ) : (
          <CachedReactMarkdown key={`text-${index}`}>{segment.text}</CachedReactMarkdown>
        ),
      )}
    </div>
  );
});
