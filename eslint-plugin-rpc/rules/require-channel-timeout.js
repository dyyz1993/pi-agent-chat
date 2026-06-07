/**
 * @fileoverview Require callChannel() calls to be wrapped in withTimeout()
 *
 * Channel calls to CLI extensions may hang indefinitely if the extension
 * is not loaded or the handler is stuck. Every callChannel() must be
 * wrapped in withTimeout() to ensure the caller falls back within a
 * bounded time.
 *
 * @example BAD
 *   const result = await manager.callChannel(sid, "hooks", "hooks.getLog", {});
 *
 * @example GOOD
 *   const result = await withTimeout(
 *     manager.callChannel(sid, "hooks", "hooks.getLog", {}),
 *     1000,
 *   );
 *
 *   // Type assertion between callChannel and withTimeout is also OK:
 *   const result = await withTimeout(
 *     manager.callChannel(sid, "lsp", "getStatus", {}) as Promise<unknown>,
 *     1000,
 *   );
 */

"use strict";

/**
 * Walk up from the callChannel node, skipping TSAsExpression / TSTypeAssertion,
 * and check whether the nearest meaningful ancestor is a withTimeout() call.
 */
function isWrappedInWithTimeout(node) {
  let current = node.parent;

  // Skip at most 2 intermediate type-assertion / await nodes
  for (let depth = 0; depth < 3 && current; depth++) {
    if (
      current.type === "CallExpression" &&
      current.callee &&
      current.callee.type === "Identifier" &&
      current.callee.name === "withTimeout"
    ) {
      return true;
    }

    // Skip type assertions
    if (
      current.type === "TSAsExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TSNonNullExpression"
    ) {
      current = current.parent;
      continue;
    }

    // Not wrapped
    break;
  }

  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "callChannel() 调用必须包裹在 withTimeout() 中，防止 channel 无响应时无限等待",
      category: "RPC Conventions",
      recommended: "warn",
    },
    messages: {
      missingTimeout:
        "callChannel() 调用必须包裹在 withTimeout() 中。" +
        '当前调用缺少超时保护，如果 channel 不响应将阻塞直到默认超时（30s）。' +
        '正确写法: withTimeout(manager.callChannel(...), 1000)',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    if (!/\.[jt]sx?$/.test(filename)) return {};

    return {
      CallExpression(node) {
        const { callee } = node;

        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "callChannel"
        ) {
          return;
        }

        if (!isWrappedInWithTimeout(node)) {
          context.report({
            node,
            messageId: "missingTimeout",
          });
        }
      },
    };
  },
};
