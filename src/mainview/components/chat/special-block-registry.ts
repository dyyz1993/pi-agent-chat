import type { ComponentType } from "react";
import type { SpecialBlock } from "./special-block-parser";

export type { SpecialBlock } from "./special-block-parser";

export type SpecialBlockRendererProps = {
  block: SpecialBlock;
};

type RegistryEntry = {
  tag: string;
  renderer: ComponentType<SpecialBlockRendererProps>;
};

const registry: RegistryEntry[] = [];
const tagSet = new Set<string>();

export function registerSpecialBlock(
  tag: string,
  renderer: ComponentType<SpecialBlockRendererProps>,
) {
  const existing = registry.findIndex((e) => e.tag === tag);
  if (existing !== -1) {
    registry[existing] = { tag, renderer };
  } else {
    tagSet.add(tag);
    registry.push({ tag, renderer });
  }
}

export function getRegisteredTags(): ReadonlySet<string> {
  return tagSet;
}

export function getRenderer(tag: string): ComponentType<SpecialBlockRendererProps> | null {
  return registry.find((e) => e.tag === tag)?.renderer ?? null;
}
