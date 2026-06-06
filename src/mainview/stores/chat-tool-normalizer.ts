import type { ChatMessage, ContentBlock } from "../types";

type ToolExecutionBlock = Extract<ContentBlock, { type: "toolExecution" }>;
type ToolCallBlock = Extract<ContentBlock, { type: "toolCall" }> & { arguments?: unknown };

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function parseArgsObject(args: string | undefined): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args) as unknown;
    return parsed && typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getToolCallInput(block: Extract<ContentBlock, { type: "toolCall" }>): unknown {
  const rawBlock = block as ToolCallBlock;
  return rawBlock.input ?? rawBlock.arguments;
}

function formatArgsFromRawInput(rawInput: unknown): {
  args: string;
  description?: string;
} {
  if (typeof rawInput === "string") {
    return { args: rawInput };
  }
  if (rawInput != null) {
    const inputObj =
      typeof rawInput === "object" && rawInput !== null ? (rawInput as Record<string, unknown>) : null;
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
  const argsObj = parseArgsObject(block.args);
  const path =
    typeof argsObj?.path === "string"
      ? argsObj.path
      : typeof argsObj?.filePath === "string"
        ? argsObj.filePath
        : undefined;
  if (path && (toolName === "edit" || toolName === "write")) {
    return filePathKeys(path).map((key) => `file-mutation:${key}`);
  }
  if (path && (toolName === "read" || toolName === "readfile")) {
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

export function dedupeToolExecutions(msgs: ChatMessage[]): void {
  const bestByKey = new Map<string, { msgIndex: number; block: ToolExecutionBlock }>();

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "toolExecution") continue;
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

export function normalizeToolBlocks(
  msgs: ChatMessage[],
  isHistorical = false,
  isStreaming = false,
): void {
  const toolCallById = new Map<
    string,
    { msgIndex: number; blockIndex: number; name: string; input: unknown }
  >();

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        toolCallById.set(b.id, {
          msgIndex: mi,
          blockIndex: bi,
          name: b.name,
          input: getToolCallInput(b),
        });
      }
    }
  }

  const execByMsg = new Map<number, Map<number, ContentBlock>>();
  const toRemove = new Set<number>();

  for (let ti = 0; ti < msgs.length; ti++) {
    const trMsg = msgs[ti];
    if (trMsg.role !== "toolResult") continue;
    const resultBlock = trMsg.content.find(
      (b): b is Extract<ContentBlock, { type: "toolResult" }> => b.type === "toolResult",
    );
    if (!resultBlock) continue;

    toRemove.add(ti);

    const match = toolCallById.get(resultBlock.toolCallId);
    const rawInput = match?.input ?? resultBlock.args;
    const { args, description } = formatArgsFromRawInput(rawInput);

    const execBlock: Extract<ContentBlock, { type: "toolExecution" }> = {
      type: "toolExecution",
      toolCallId: resultBlock.toolCallId,
      toolName: resultBlock.toolName ?? match?.name ?? "unknown",
      args,
      status: resultBlock.isError ? "error" : "done",
      output: resultBlock.content || undefined,
      details: resultBlock.details,
      description,
    };

    let targetMi: number;
    let targetBi: number;
    if (match) {
      targetMi = match.msgIndex;
      targetBi = match.blockIndex;
    } else {
      targetMi = ti - 1;
      while (targetMi >= 0 && msgs[targetMi].role !== "assistant") targetMi--;
      targetBi = -1;
    }

    if (targetMi < 0) {
      const syntheticMsg: ChatMessage = {
        id: `synthetic-${trMsg.id}`,
        role: "assistant",
        content: [execBlock],
        timestamp: trMsg.timestamp,
      };
      msgs[ti] = syntheticMsg;
      toRemove.delete(ti);
      continue;
    }

    if (!execByMsg.has(targetMi)) execByMsg.set(targetMi, new Map());
    execByMsg.get(targetMi)?.set(targetBi, execBlock);
  }

  for (const [mi, biToBlock] of execByMsg) {
    const msg = msgs[mi];
    const newContent: ContentBlock[] = [];
    const orphanBlocks = biToBlock.get(-1);
    let orphanUsed = false;
    for (let bi = 0; bi < msg.content.length; bi++) {
      const b = msg.content[bi];
      if (b.type === "toolCall") {
        const exec = biToBlock.get(bi);
        if (exec) {
          newContent.push(exec);
        } else if (orphanBlocks && !orphanUsed) {
          newContent.push(orphanBlocks);
          orphanUsed = true;
        } else {
          const { args, description } = formatArgsFromRawInput(getToolCallInput(b));
          newContent.push({
            type: "toolExecution",
            toolCallId: b.id,
            toolName: b.name,
            args,
            status: isStreaming ? "running" : isHistorical ? "unknown" : "running",
            description,
          });
        }
      } else {
        newContent.push(b);
      }
    }
    if (orphanBlocks && !orphanUsed) {
      newContent.push(orphanBlocks);
    }
    msgs[mi] = { ...msg, content: newContent };
  }

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;

    const existingExecutionIds = new Set<string>();
    const dedupedContent: ContentBlock[] = [];
    for (let bi = msg.content.length - 1; bi >= 0; bi--) {
      const block = msg.content[bi];
      if (block.type === "toolExecution") {
        if (existingExecutionIds.has(block.toolCallId)) continue;
        existingExecutionIds.add(block.toolCallId);
      }
      dedupedContent.unshift(block);
    }

    if (dedupedContent.length !== msg.content.length) {
      msgs[mi] = { ...msg, content: dedupedContent };
    }
  }

  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    if (msg.role !== "assistant") continue;

    const executionIds = new Set(
      msg.content
        .filter((b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution")
        .map((b) => b.toolCallId),
    );

    let hasToolCall = false;
    for (const b of msg.content) {
      if (b.type === "toolCall") {
        hasToolCall = true;
        break;
      }
    }
    if (!hasToolCall) continue;

    if (execByMsg.has(mi)) continue;

    const newContent: ContentBlock[] = [];
    for (const b of msg.content) {
      if (b.type === "toolCall") {
        if (executionIds.has(b.id)) continue;
        const { args } = formatArgsFromRawInput(getToolCallInput(b));
        newContent.push({
          type: "toolExecution",
          toolCallId: b.id,
          toolName: b.name,
          args,
          status: isHistorical ? "unknown" : "running",
        });
      } else {
        newContent.push(b);
      }
    }
    msgs[mi] = { ...msg, content: newContent };
  }

  dedupeToolExecutions(msgs);

  if (toRemove.size > 0) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (toRemove.has(i)) msgs.splice(i, 1);
    }
  }

  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i].content.length === 0) {
      msgs.splice(i, 1);
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
  for (const msg of finalMsgs) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (
        block.type === "toolExecution" &&
        (block.status === "done" || block.status === "error")
      ) {
        for (const key of getToolExecutionDedupeKeys(block)) {
          terminalKeys.add(key);
        }
      }
    }
  }

  const preservedContent = streamingMsg.content.filter(
    (block) =>
      block.type === "toolExecution" &&
      block.status === "running" &&
      !getToolExecutionDedupeKeys(block).some((key) => terminalKeys.has(key)),
  );

  if (preservedContent.length === 0) return undefined;
  return { ...streamingMsg, content: preservedContent };
}
