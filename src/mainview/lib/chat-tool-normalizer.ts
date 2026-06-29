import type { ChatMessage, ContentBlock } from "../types";
import { formatArgsFromRawInput, getToolCallInput } from "./tool-execution-reconciler";

export {
  buildPreservedStreamingMessage,
  dedupeToolExecutions,
  getToolExecutionDedupeKeys,
  hasOverlappingToolExecutionKeys,
  shouldAppendPreservedStreamingMessage,
} from "./tool-execution-reconciler";

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
        .filter(
          (b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution",
        )
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

  // NOTE: dedupeToolExecutions and empty-assistant removal were previously
  // called here but caused historical messages to disappear after page refresh.
  // The semantic cross-message dedup (e.g. two reads of the same file) would
  // strip toolExecution blocks from earlier messages, leaving them empty, and
  // then the empty-message cleanup would delete them entirely. These steps
  // should only be applied during active streaming, not during historical load.
  // Callers that need dedup (streaming merges) invoke it explicitly.

  if (toRemove.size > 0) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (toRemove.has(i)) msgs.splice(i, 1);
    }
  }
}
