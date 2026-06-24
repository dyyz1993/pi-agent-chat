import { memo } from "react";
import { ContextReferenceCard, referencesFromSpecialBlock } from "../ContextReferenceCard";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

export const SkillBlockCard = memo(function SkillBlockCard({ block }: SpecialBlockRendererProps) {
  return <ContextReferenceCard references={referencesFromSpecialBlock(block)} />;
});

registerSpecialBlock("skill", SkillBlockCard);
