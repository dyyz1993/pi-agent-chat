import { memo } from "react";
import { TextContentCard } from "./TextContentCard";
import { ThinkingCard } from "./ThinkingCard";
import { LspDiagnosticsCard } from "./LspDiagnosticsCard";
import { CompactionSummaryCard } from "./CompactionSummaryCard";
import { ToolExecutionCard } from "./ToolExecutionCard";
import { MEMORY_CUSTOM_TYPES, MemoryCard } from "./MemoryCard";
import { SnapshotBadge } from "./snapshot/SnapshotBadge";
import { SubagentExecutionCard } from "./tool-renderers/SubagentRenderer";
import { UIInteractionCard } from "./tool-renderers/UICardRenderer";
import { getToolRenderer } from "./tool-renderers";
import {
  MEMORY_HIDDEN_IN_CHAT,
  isLspCustomType,
  isLspVisibleInChat,
} from "./lsp-constants";
import { useSettingsStore } from "../../stores/use-settings-store";
import type { ContentBlock, UIInteractionBlock } from "../../types";

export interface ContentBlockRendererProps {
  block: ContentBlock;
  isStreaming?: boolean;
  msgId: string;
  blockIndex: number;
  isEntry?: boolean;
  uiBlockMap: Map<string, UIInteractionBlock>;
  mergedResultData?: unknown;
}

export const ContentBlockRenderer = memo(function ContentBlockRenderer({
  block,
  isStreaming,
  msgId,
  blockIndex,
  isEntry,
  uiBlockMap,
  mergedResultData,
}: ContentBlockRendererProps) {
  const blockId = `${msgId}-${blockIndex}`;
  const showToolCalls = useSettingsStore((s) => s.showToolCalls);
  const showToolResults = useSettingsStore((s) => s.showToolResults);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const toolCallId =
    block.type === "toolExecution"
      ? block.toolCallId
      : block.type === "toolCall"
        ? block.id
        : block.type === "toolResult"
          ? block.toolCallId
          : undefined;
  const uiBlock = toolCallId ? uiBlockMap.get(toolCallId) : undefined;

  switch (block.type) {
    case "text":
      return <TextContentCard text={block.text} isStreaming={isStreaming} blockId={blockId} />;
    case "thinking":
      if (!showThinking) return null;
      return (
        <ThinkingCard thinking={block.thinking} isStreaming={!!isStreaming} blockId={blockId} />
      );
    case "toolCall":
      if (!showToolCalls) return null;
      {
        const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
          type: "toolExecution",
          toolCallId: block.id,
          toolName: block.name,
          args: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
          status: "running",
        };
        const renderer = getToolRenderer(execBlock.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
        }
        return <ToolExecutionCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
      }
    case "toolResult":
      if (!showToolResults) return null;
      {
        const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
          type: "toolExecution",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          args: typeof block.args === "string" ? block.args : JSON.stringify(block.args ?? {}),
          status: block.isError ? "error" : "done",
          output: block.content,
          details: block.details,
        };
        const renderer = getToolRenderer(execBlock.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
        }
        return <ToolExecutionCard block={execBlock} blockId={blockId} uiBlock={uiBlock} />;
      }
    case "toolExecution":
      if (!showToolCalls) return null;
      {
        if (block.toolName.toLowerCase() === "subagent") {
          return <SubagentExecutionCard block={block} blockId={blockId} />;
        }
        const renderer = getToolRenderer(block.toolName);
        if (renderer?.renderExecution) {
          const CustomCard = renderer.renderExecution;
          return <CustomCard block={block} blockId={blockId} uiBlock={uiBlock} />;
        }
        return <ToolExecutionCard block={block} blockId={blockId} uiBlock={uiBlock} />;
      }
    case "custom":
      if (isLspCustomType(block.customType)) {
        if (!isLspVisibleInChat(block.customType)) {
          return null;
        }
        return <LspDiagnosticsCard data={block.data} />;
      }
      if (MEMORY_HIDDEN_IN_CHAT.has(block.customType)) {
        return null;
      }
      if (block.customType === "step_snapshot") {
        return <SnapshotBadge data={block.data} blockId={blockId} />;
      }
      if (!MEMORY_CUSTOM_TYPES.has(block.customType)) {
        return null;
      }
      return (
        <MemoryCard
          customType={block.customType}
          data={block.data}
          blockId={blockId}
          isEntry={isEntry}
          mergedResultData={mergedResultData}
        />
      );
    case "compactionSummary":
      return <CompactionSummaryCard summary={block.summary} blockId={blockId} />;
    case "imageBlock":
      return (
        <div data-block-id={blockId} className="my-1 px-3">
          <img
            src={block.url}
            alt={block.alt ?? ""}
            className="max-w-full max-h-[400px] rounded-lg border border-border-secondary/50"
            loading="lazy"
          />
        </div>
      );
    case "uiInteraction":
      return <UIInteractionCard block={block} />;
  }
});
