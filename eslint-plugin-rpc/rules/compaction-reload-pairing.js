/**
 * @fileoverview compactionDeferredSessions.add() 必须有对应的 agent_end 兜底检查
 *
 * agent-event-handler.ts 中维护了一个 compactionDeferredSessions Set，
 * 用于在 streaming 中压缩时延迟 reload 到 agent_end。
 *
 * 不变量：
 *   1. compaction_end 中 streaming 时必须 add(sessionId) 到 compactionDeferredSessions
 *   2. agent_end 中必须检查 compactionDeferredSessions.has(sessionId) 并 delete + force reload
 *   3. 如果 add 了但 agent_end 中没有对应的 flush，则 reload 会永久丢失
 *
 * 本规则检测：
 *   - 如果文件中有 compactionDeferredSessions.add 调用，
 *     则必须也有对应的 .has() + .delete() + loadSessionMessages({ force: true }) 调用
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "compactionDeferredSessions.add() 必须有对应的 agent_end 兜底检查（has + delete + force reload）",
      category: "Compaction",
      recommended: "error",
    },
    messages: {
      missingDeferredFlush:
        "compactionDeferredSessions.add() 已调用但缺少对应的 flush 逻辑。" +
        "agent_end 处理器中必须有 compactionDeferredSessions.has() + .delete() + loadSessionMessages({ force: true })，" +
        "否则 streaming 中压缩后的 reload 会永久丢失。",
      missingDeferredAdd:
        "compaction_end 中 isActivelyStreaming 分支缺少 compactionDeferredSessions.add()。" +
        "如果跳过 force reload 但不记录补偿，streaming 结束后消息永远不同步。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // Only check agent-event-handler.ts
    if (!/agent-event-handler\.ts$/.test(filename)) return {};

    let hasAdd = false;
    let hasFlush = false;
    let addNode = null;
    let flushNode = null;

    return {
      CallExpression(node) {
        const source = context.getSourceCode().getText(node);

        // Check for compactionDeferredSessions.add(...)
        if (source.includes("compactionDeferredSessions.add")) {
          hasAdd = true;
          addNode = node;
        }
      },
      "Program:exit"() {
        // Get full file source to check for flush pattern
        const source = context.getSourceCode().text;

        // Check for flush pattern: .has(sessionId) + .delete(sessionId) + loadSessionMessages + force: true
        const hasHasCheck = source.includes("compactionDeferredSessions.has");
        const hasDelete = source.includes("compactionDeferredSessions.delete");
        const hasForceReload =
          source.includes("loadSessionMessages") &&
          source.includes("force: true");

        hasFlush = hasHasCheck && hasDelete && hasForceReload;

        if (hasAdd && !hasFlush) {
          context.report({
            node: addNode,
            messageId: "missingDeferredFlush",
          });
        }

        // Also check reverse: if compaction_end skips force reload for streaming,
        // it MUST add to deferred set
        const hasStreamingSkip =
          source.includes("isActivelyStreaming") &&
          source.includes("compaction_end");
        if (hasStreamingSkip && !hasAdd) {
          // Find the compaction_end handler to report on
          const lines = source.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("compaction_end")) {
              // Report on the first line containing compaction_end
              const loc = { line: i + 1, column: 0 };
              context.report({
                loc,
                messageId: "missingDeferredAdd",
              });
              break;
            }
          }
        }
      },
    };
  },
};
