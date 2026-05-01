/**
 * @fileoverview handlers/index.ts 禁止使用 namespace import + Object.values 遍历
 *
 * 根因：barrel export 混合了 register 和 cleanup 函数，Object.values() 会遍历到所有导出。
 * 必须使用 handlerMap / cleanupMap 分组导出，消费方分别遍历。
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "禁止对 namespace import (import * as X) 使用 Object.values() 遍历来调用函数，防止混合导出被误调",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      noObjectValuesOnNamespace:
        "禁止对 namespace import '{{name}}' 使用 Object.values() 遍历调用。这会把所有导出（包括 cleanup 等非目标函数）都当同一类型调用。请使用分组导出（handlerMap/cleanupMap）分别遍历。",
    },
    schema: [],
  },

  create(context) {
    const namespaceImports = new Set();

    return {
      ImportDeclaration(node) {
        if (node.specifiers.length === 1) {
          const spec = node.specifiers[0];
          if (
            spec.type === "ImportNamespaceSpecifier" &&
            spec.local.type === "Identifier"
          ) {
            namespaceImports.add(spec.local.name);
          }
        }
      },

      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "Object" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "values"
        ) {
          const arg = node.arguments[0];
          if (
            arg &&
            arg.type === "Identifier" &&
            namespaceImports.has(arg.name)
          ) {
            context.report({
              node,
              messageId: "noObjectValuesOnNamespace",
              data: { name: arg.name },
            });
          }
        }
      },
    };
  },
};
