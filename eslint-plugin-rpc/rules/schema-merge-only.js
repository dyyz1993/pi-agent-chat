/**
 * @fileoverview rpc-schema.ts 只允许合并，禁止直接定义方法
 *
 * RPCMethods 和 RPCEvents 接口必须是空的 extends 合并体，
 * 不允许直接在其中定义方法属性。
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "rpc-schema.ts 禁止直接定义方法，只允许 extends 合并",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      noDirectDefinition:
        'rpc-schema.ts 中禁止直接定义方法 "{{key}}"。请在 src/shared/modules/ 下对应模块文件中定义，然后在此处 extends 合并。',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // 只检查 rpc-schema.ts
    if (!filename.endsWith("rpc-schema.ts") && !filename.endsWith("rpc-schema.tsx")) return {};

    // 已知的合并接口名
    const schemaInterfaces = new Set(["RPCMethods", "RPCEvents"]);

    return {
      TSInterfaceDeclaration(node) {
        if (!schemaInterfaces.has(node.id.name)) return;

        // 检查 interface body 中是否有直接定义的属性
        if (node.body && node.body.body) {
          for (const member of node.body.body) {
            // TSPropertySignature 表示直接定义的属性
            if (member.type === "TSPropertySignature" && member.key) {
              const keyName =
                member.key.type === "Identifier"
                  ? member.key.name
                  : member.key.type === "Literal"
                    ? String(member.key.value)
                    : null;

              if (keyName) {
                context.report({
                  node: member,
                  messageId: "noDirectDefinition",
                  data: { key: keyName },
                });
              }
            }
          }
        }
      },
    };
  },
};
