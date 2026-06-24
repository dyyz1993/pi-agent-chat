import { memo } from "react";
import { HookInterventionCard, interventionFromHookBlock } from "../HookInterventionCard";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";

export const HookBlockCard = memo(function HookBlockCard({ block }: SpecialBlockRendererProps) {
  return <HookInterventionCard intervention={interventionFromHookBlock(block)} />;
});

registerSpecialBlock("hook", HookBlockCard);
