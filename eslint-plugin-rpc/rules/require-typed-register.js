/**
 * @fileoverview 入口文件必须导入 registerAllHandlers
 *
 * 架构变更：handler 定义集中在 shared/handlers/ 中，入口文件
 * （bun/index.ts、server.ts）必须导入并调用 registerAllHandlers() 统一注册。
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "入口文件必须导入并调用 registerAllHandlers",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      missingRegisterAllHandlersImport:
        "入口文件必须导入 registerAllHandlers。请添加：import { registerAllHandlers } from \"./shared/handlers/register-all-handlers\";",
      missingRegisterAllHandlersCall:
        "已导入 registerAllHandlers 但未调用。请在创建 server 后调用 registerAllHandlers(server)。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // 只检查入口文件（server.ts 已拆分，实际注册在 ws-handler.ts 中）
    const isEntryPoint =
      filename.endsWith("bun/index.ts") || filename.endsWith("gateway/ws-handler.ts");

    if (!isEntryPoint) return {};

    let hasRegisterAllHandlersImport = false;
    let hasRegisterAllHandlersCall = false;
    let importNode = null;

    return {
      // 检查 import 声明
      ImportDeclaration(node) {
        if (
          node.source.type === "Literal" &&
          typeof node.source.value === "string" &&
          node.source.value.includes("register-all-handlers")
        ) {
          for (const specifier of node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.imported.name === "registerAllHandlers"
            ) {
              hasRegisterAllHandlersImport = true;
              importNode = node;
            }
          }
        }
      },

      // 检查 registerAllHandlers() 调用
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "registerAllHandlers"
        ) {
          hasRegisterAllHandlersCall = true;
        }
      },

      "Program:exit"() {
        if (!hasRegisterAllHandlersImport) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "missingRegisterAllHandlersImport",
          });
        } else if (!hasRegisterAllHandlersCall) {
          context.report({
            node: importNode,
            messageId: "missingRegisterAllHandlersCall",
          });
        }
      },
    };
  },
};
