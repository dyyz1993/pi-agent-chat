/**
 * @fileoverview 强制前端使用 apiClient 进行 RPC 调用
 *
 * 前端代码（mainview/）中的 RPC 调用必须通过 apiClient，
 * 禁止直接使用 WebSocket 或其他底层通信方式。
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "前端 RPC 调用必须通过 apiClient",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      useApiClient:
        "前端 RPC 调用必须通过 apiClient.call() / apiClient.subscribe()。禁止直接操作 WebSocket 或其他传输层。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // 只检查 mainview/ 下的 .ts/.tsx 文件
    if (!/mainview\/.*\.[jt]sx?$/.test(filename)) return {};

    return {
      // 检测 new WebSocket() 调用
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "WebSocket"
        ) {
          context.report({
            node,
            messageId: "useApiClient",
          });
        }
      },

      // 检测 websocket.send() 调用
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "send"
        ) {
          // 检查是否在操作 websocket 变量
          if (node.callee.object.type === "Identifier") {
            const objName = node.callee.object.name.toLowerCase();
            if (objName.includes("websocket") || objName.includes("ws")) {
              context.report({
                node,
                messageId: "useApiClient",
              });
            }
          }
        }
      },
    };
  },
};
