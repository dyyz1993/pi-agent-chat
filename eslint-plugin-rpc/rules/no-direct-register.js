/**
 * @fileoverview server.register() 只允许在 shared/handlers/ 目录内使用
 *
 * Handler 定义集中在 src/shared/handlers/ 中，入口文件（bun/index.ts、server.ts）
 * 和其他 src/ 文件禁止直接调用 server.register()，必须通过 registerAllHandlers() 统一注册。
 */

"use strict";

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "server.register() 只允许在 shared/handlers/ 目录内使用，入口文件和其他文件禁止直接调用",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      noDirectRegisterInEntry:
        "入口文件禁止直接调用 server.register()。请导入并使用 registerAllHandlers() 统一注册 handler。",
      noDirectRegisterGeneral:
        "禁止直接调用 server.register()。Handler 注册只能在 shared/handlers/ 目录内的文件中进行。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // 只检查 src/ 下的 .ts/.tsx 文件
    if (!/src\/.*\.[jt]sx?$/.test(filename)) return {};

    // 允许在 shared/handlers/ 目录内使用 register
    if (filename.includes("shared/handlers/")) return {};

    // 判断是否为入口文件
    const isEntryPoint =
      filename.endsWith("bun/index.ts") || filename.endsWith("server.ts");

    return {
      CallExpression(node) {
        const { callee } = node;

        // 检测 xxx.register("...", ...) 模式
        if (
          callee.type === "MemberExpression" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "register" &&
          callee.object.type === "Identifier"
        ) {
          const objectName = callee.object.name;

          // 禁止的模式：server.register(), rpcServer.register() 等
          const serverVarNames = [
            "server",
            "rpcServer",
            "rpc",
            "rpc_server",
          ];

          if (serverVarNames.includes(objectName)) {
            context.report({
              node,
              messageId: isEntryPoint
                ? "noDirectRegisterInEntry"
                : "noDirectRegisterGeneral",
            });
          }
        }
      },
    };
  },
};
