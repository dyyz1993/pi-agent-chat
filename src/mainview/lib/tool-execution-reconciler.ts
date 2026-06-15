import type { ChatMessage, ContentBlock, TimelineItem } from "../types";
import { parseToolArgs } from "../utils/parse-tool-args";

export type ToolExecutionBlock = Extract<ContentBlock, { type: "toolExecution" }>;
export type ToolCallBlock = Extract<ContentBlock, { type: "toolCall" }> & {
  arguments?: unknown;
};
export type ToolExecutionItem = Extract<TimelineItem, { itemType: "toolExecution" }>;

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

export function getToolCallInput(block: Extract<ContentBlock, { type: "toolCall" }>): unknown {
  const rawBlock = block as ToolCallBlock;
  return rawBlock.input ?? rawBlock.arguments;
}

export function formatArgsFromRawInput(rawInput: unknown): {
  args: string;
  description?: string;
} {
  if (typeof rawInput === "string") {
    try {
      const parsed = JSON.parse(rawInput) as unknown;
      if (parsed && typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        return {
          args: rawInput,
          description: typeof obj.description === "string" ? obj.description : undefined,
        };
      }
    } catch {
      // Plain command strings are common for live tool events.
    }
    return { args: rawInput };
  }
  if (rawInput != null) {
    const inputObj =
      typeof rawInput === "object" && rawInput !== null
        ? (rawInput as Record<string, unknown>)
        : null;
    return {
      args: JSON.stringify(rawInput, null, 2),
      description: typeof inputObj?.description === "string" ? inputObj.description : undefined,
    };
  }
  return { args: "" };
}

function filePathKeys(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/").trim();
  const keys = [`path:${normalized}`];
  const projectRelativeMarkers = ["/crates/", "/src/", "/test/", "/tests/", "/docs/"];
  for (const marker of projectRelativeMarkers) {
    const idx = normalized.lastIndexOf(marker);
    if (idx >= 0) {
      keys.push(`path:${normalized.slice(idx + 1)}`);
    }
  }
  return Array.from(new Set(keys));
}

function toolExecutionSemanticKeys(block: ToolExecutionBlock): string[] {
  const toolName = normalizeToolName(block.toolName);
  const argsObj = parseToolArgs(block.args);
  const path =
    typeof argsObj?.path === "string"
      ? argsObj.path
      : typeof argsObj?.filePath === "string"
        ? argsObj.filePath
        : undefined;

  const fileMutationTools = new Set([
    "edit",
    "write",
    "file_edit",
    "file_write",
    "write_file",
    "multiedit",
    "multi_edit",
  ]);
  const fileReadTools = new Set(["read", "readfile", "read_file", "file_read"]);

  if (path && fileMutationTools.has(toolName)) {
    return filePathKeys(path).map((key) => `file-mutation:${key}`);
  }
  if (path && fileReadTools.has(toolName)) {
    return filePathKeys(path).map((key) => `file-read:${key}`);
  }

  const command =
    typeof argsObj?.command === "string" ? argsObj.command : toolName === "bash" ? block.args : "";
  if (command && toolName === "bash") {
    return [`${toolName}:command:${command.trim()}`];
  }

  return [];
}

export function getToolExecutionDedupeKeys(block: ToolExecutionBlock): string[] {
  const keys = [`id:${block.toolCallId}`];
  const semanticKeys = toolExecutionSemanticKeys(block);
  for (const semanticKey of semanticKeys) keys.push(`semantic:${semanticKey}`);
  return keys;
}

export function hasOverlappingToolExecutionKeys(
  a: ToolExecutionBlock,
  b: ToolExecutionBlock,
): boolean {
  const aKeys = new Set(getToolExecutionDedupeKeys(a));
  return getToolExecutionDedupeKeys(b).some((key) => aKeys.has(key));
}

function toolExecutionScore(block: ToolExecutionBlock): number {
  let score = 0;
  if (block.status === "done" || block.status === "error") score += 100;
  if (block.status === "running") score += 50;
  if (block.output) score += 10;
  if (block.details) score += 10;
  if (block.endedAt) score += 5;
  if (block.startedAt) score += 1;
  return score;
}

function normalizeToolDescription(description: string | undefined): string {
  return (description ?? "").trim().replace(/\s+/g, " ");
}

function getToolExecutionDescription(block: ToolExecutionBlock): string | undefined {
  if (block.description) return block.description;
  const argsObj = parseToolArgs(block.args);
  if (typeof argsObj?.description === "string") return argsObj.description;
  return undefined;
}

function toolDescriptionKey(block: ToolExecutionBlock): string {
  const description = normalizeToolDescription(getToolExecutionDescription(block));
  if (!description) return "";
  return `${normalizeToolName(block.toolName)}:${description}`;
}

function isTerminalToolExecution(block: ContentBlock): block is ToolExecutionBlock {
  return block.type === "toolExecution" && (block.status === "done" || block.status === "error");
}

export function dedupeToolExecutions(msgs: ChatMessage[]): void {
  const bestByKey = new Map<string, { msgIndex: number; block: ToolExecutionBlock }>();
  const latestTerminalByDescription = new Map<
    string,
    { msgIndex: number; block: ToolExecutionBlock }
  >();

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "toolExecution") continue;
      if (isTerminalToolExecution(block)) {
        const descriptionKey = toolDescriptionKey(block);
        if (descriptionKey) {
          const previous = latestTerminalByDescription.get(descriptionKey);
          if (!previous || msg.timestamp >= msgs[previous.msgIndex].timestamp) {
            latestTerminalByDescription.set(descriptionKey, {
              msgIndex: mi,
              block,
            });
          }
        }
      }
      const keys = getToolExecutionDedupeKeys(block);
      const previous = keys.map((key) => bestByKey.get(key)).find((candidate) => candidate);
      if (!previous || toolExecutionScore(block) >= toolExecutionScore(previous.block)) {
        for (const key of keys) {
          bestByKey.set(key, { msgIndex: mi, block });
        }
      }
    }
  }

  if (bestByKey.size === 0) return;

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;

    let changed = false;
    const newContent = msg.content.filter((block) => {
      if (block.type !== "toolExecution") return true;
      if (block.status === "running") {
        const descriptionKey = toolDescriptionKey(block);
        const terminal = descriptionKey
          ? latestTerminalByDescription.get(descriptionKey)
          : undefined;
        if (terminal) {
          changed = true;
          return false;
        }
      }
      const keys = getToolExecutionDedupeKeys(block);
      const keep = keys.every((key) => {
        const best = bestByKey.get(key);
        return best?.msgIndex === mi && best.block === block;
      });
      if (!keep) changed = true;
      return keep;
    });

    if (changed) {
      msgs[mi] = { ...msg, content: newContent };
    }
  }
}

export function shouldAppendPreservedStreamingMessage(
  finalMsgs: ChatMessage[],
  streamingMsg: ChatMessage | undefined,
): boolean {
  return buildPreservedStreamingMessage(finalMsgs, streamingMsg) !== undefined;
}

export function buildPreservedStreamingMessage(
  finalMsgs: ChatMessage[],
  streamingMsg: ChatMessage | undefined,
): ChatMessage | undefined {
  if (!streamingMsg || streamingMsg.role !== "assistant" || streamingMsg.isStreaming !== true) {
    return undefined;
  }

  const terminalKeys = new Set<string>();
  const terminalBlocks: ToolExecutionBlock[] = [];
  for (const msg of finalMsgs) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (isTerminalToolExecution(block)) {
        terminalBlocks.push(block);
        for (const key of getToolExecutionDedupeKeys(block)) {
          terminalKeys.add(key);
        }
      }
    }
  }

  const preservedContent = streamingMsg.content.filter((block) => {
    // Always preserve non-toolExecution blocks (text, thinking, images, custom).
    // These are never in JSONL during streaming and must survive background refresh.
    if (block.type !== "toolExecution") return true;

    // For toolExecution blocks, skip if already present as a terminal block in JSONL
    if (getToolExecutionDedupeKeys(block).some((key) => terminalKeys.has(key))) return false;

    const description = normalizeToolDescription(getToolExecutionDescription(block));
    if (!description) return true;

    const toolName = normalizeToolName(block.toolName);
    const hasTerminalWithSameDescription = terminalBlocks.some((terminal) => {
      return (
        normalizeToolName(terminal.toolName) === toolName &&
        normalizeToolDescription(getToolExecutionDescription(terminal)) === description
      );
    });

    return !hasTerminalWithSameDescription;
  });

  if (preservedContent.length === 0) return undefined;
  return { ...streamingMsg, content: preservedContent };
}

export function normalizeToolArgsForMatch(args: string | undefined): string {
  if (!args) return "";
  try {
    const parsed = JSON.parse(args) as unknown;
    if (parsed && typeof parsed === "object" && parsed !== null) {
      const command = (parsed as Record<string, unknown>).command;
      if (typeof command === "string") return command.trim();
    }
  } catch {
    // Plain command strings are expected for live execution events.
  }
  return args.trim();
}

export function findMatchingPendingToolExecution(
  blocks: ContentBlock[],
  toolName: string,
  args: string,
): number {
  return findMatchingToolExecution(blocks, toolName, args, { includeTerminal: false });
}

export function findMatchingToolExecution(
  blocks: ContentBlock[],
  toolName: string,
  args: string,
  options: { includeTerminal?: boolean } = {},
): number {
  const targetArgs = normalizeToolArgsForMatch(args);
  if (!targetArgs) return -1;
  const incoming: ToolExecutionBlock = {
    type: "toolExecution",
    toolCallId: "__incoming__",
    toolName,
    args,
    status: "running",
  };
  return blocks.findIndex((block): block is ToolExecutionBlock => {
    if (block.type !== "toolExecution") {
      return false;
    }
    if (!options.includeTerminal && (block.status === "done" || block.status === "error")) {
      return false;
    }
    return hasOverlappingToolExecutionKeys(block, incoming);
  });
}

export function toolExecutionItemToBlock(item: ToolExecutionItem): ToolExecutionBlock {
  return {
    type: "toolExecution",
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    args: item.args,
    status: item.status,
    output: item.output,
    details: item.details,
  };
}
