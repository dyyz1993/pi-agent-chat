/**
 * @fileoverview JSONL 解析中 compaction entry 必须同时 push 到 allCompactionEntries 和 allMessages
 *
 * process-manager.ts 的 getFullMessages 方法有两个 JSONL 解析分支：
 *   1. sandbox 路径（cat 命令读取）
 *   2. 本地文件路径（createReadStream 读取）
 *
 * 每个分支中，遇到 parsed.type === "compaction" 时必须同时：
 *   a) push 到 allCompactionEntries（用于 streaming merge dedup）
 *   b) push 到 allMessages（用于前端消息渲染，保持 JSONL 时间顺序）
 *
 * 如果只做了 (a) 没做 (b)，compactionSummary 会在刷新后消失。
 * 如果只做了 (b) 没做 (a)，streaming 时会出现重复 compactionSummary。
 *
 * 本规则检测 getFullMessages 方法内所有 parsed.type === "compaction" 分支，
 * 确保紧跟其后有对 allMessages 的 push 调用。
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "JSONL 解析中 compaction entry 必须同时 push 到 allCompactionEntries 和 allMessages",
      category: "Compaction",
      recommended: "error",
    },
    messages: {
      missingAllMessagesPush:
        "compaction 分支中缺少 allMessages.push()。解析 type === 'compaction' 时必须同时 push 到 allMessages（注入 compactionSummary），否则刷新后压缩摘要会消失。",
      missingAllCompactionEntriesPush:
        "compaction 分支中缺少 allCompactionEntries.push()。必须同时 push 到 allCompactionEntries，否则 streaming merge 会出现重复 compactionSummary。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // Only check process-manager.ts
    if (!/process-manager\.ts$/.test(filename)) return {};

    // Track if we're inside getFullMessages method
    let inGetFullMessages = false;
    let functionName = null;

    return {
      // Detect function/method named getFullMessages
      FunctionDeclaration(node) {
        if (node.id && node.id.name === "getFullMessages") {
          inGetFullMessages = true;
          functionName = node;
        }
      },
      MethodDefinition(node) {
        if (
          node.key &&
          node.key.type === "Identifier" &&
          node.key.name === "getFullMessages"
        ) {
          inGetFullMessages = true;
          functionName = node;
        }
      },
      "FunctionDeclaration:exit"(node) {
        if (node.id && node.id.name === "getFullMessages") {
          inGetFullMessages = false;
          functionName = null;
        }
      },
      "MethodDefinition:exit"(node) {
        if (
          node.key &&
          node.key.type === "Identifier" &&
          node.key.name === "getFullMessages"
        ) {
          inGetFullMessages = false;
          functionName = null;
        }
      },

      // Match: } else if (parsed.type === "compaction") { ... }
      IfStatement(node) {
        if (!inGetFullMessages) return;

        const test = node.test;
        if (!test) return;

        // Check for pattern: parsed.type === "compaction"
        if (
          test.type === "BinaryExpression" &&
          test.operator === "===" &&
          test.left.type === "MemberExpression" &&
          test.left.property.type === "Identifier" &&
          test.left.property.name === "type" &&
          test.right.type === "Literal" &&
          test.right.value === "compaction"
        ) {
          const consequent = node.consequent;
          if (!consequent || consequent.type !== "BlockStatement") return;

          const body = consequent.body;

          // Scan the block for push calls
          let hasAllCompactionEntriesPush = false;
          let hasAllMessagesPush = false;

          for (const stmt of body) {
            const source = context.getSourceCode().getText(stmt);
            if (source.includes("allCompactionEntries.push")) {
              hasAllCompactionEntriesPush = true;
            }
            if (
              source.includes("allMessages.push") &&
              source.includes("compactionSummary")
            ) {
              hasAllMessagesPush = true;
            }
          }

          if (!hasAllCompactionEntriesPush) {
            context.report({
              node,
              messageId: "missingAllCompactionEntriesPush",
            });
          }

          if (!hasAllMessagesPush) {
            context.report({
              node,
              messageId: "missingAllMessagesPush",
            });
          }
        }
      },
    };
  },
};
