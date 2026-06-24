import { memo } from "react";
import { ContextReferenceCard, referencesFromSpecialBlock } from "../ContextReferenceCard";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

export const LspBlockCard = memo(function LspBlockCard({ block }: SpecialBlockRendererProps) {
  return <ContextReferenceCard references={referencesFromSpecialBlock(block)} />;
});

registerSpecialBlock("lsp", LspBlockCard);
