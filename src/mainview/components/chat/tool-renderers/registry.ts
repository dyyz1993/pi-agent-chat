import type { ComponentType } from "react";
import type { ContentBlock, UIInteractionBlock } from "../../../types";

export interface ToolRendererProps {
  block: Extract<ContentBlock, { type: "toolExecution" }>;
  blockId?: string;
  uiBlock?: UIInteractionBlock;
}

export interface ToolRenderer {
  renderCall?: ComponentType<ToolRendererProps>;
  renderExecution?: ComponentType<ToolRendererProps>;
  renderResult?: ComponentType<ToolRendererProps>;
}

const registry = new Map<string, ToolRenderer>();

export function registerToolRenderer(toolName: string, renderer: ToolRenderer): void {
  registry.set(toolName.toLowerCase(), renderer);
}

export function getToolRenderer(toolName: string): ToolRenderer | undefined {
  const key = toolName.toLowerCase();
  const exact = registry.get(key);
  if (exact) return exact;
  for (const [k, v] of registry) {
    if (key.includes(k)) return v;
  }
  return undefined;
}
