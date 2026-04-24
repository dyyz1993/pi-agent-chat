/**
 * @fileoverview 禁止使用裸方法名（无模块前缀）
 *
 * RPC 方法名必须使用 "module.action" 格式（点分隔），
 * 禁止使用裸方法名如 "ping"、"listDir" 等。
 *
 * 检测范围：
 *   - register("xxx", ...)
 *   - apiClient.call("xxx", ...)
 *   - apiClient.subscribe("xxx", ...)
 *   - server.emitEvent("xxx", ...)
 */

"use strict";

const METHOD_CALL_PATTERNS = [
  // register("xxx", ...)
  { calleePattern: /^register$/, argIndex: 0 },
  // apiClient.call("xxx", ...)
  { calleePattern: /\.call$/, argIndex: 0 },
  // apiClient.subscribe("xxx", ...)
  { calleePattern: /\.subscribe$/, argIndex: 0 },
  // server.emitEvent("xxx", ...)
  { calleePattern: /\.emitEvent$/, argIndex: 0 },
];

/** 判断字符串是否是合法的模块化方法名 (module.action) */
function isModuleMethodName(name) {
  // 必须包含且仅包含一个点，点前后都要有内容
  const parts = name.split(".");
  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "RPC 方法名必须使用 module.action 格式（禁止裸方法名）",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      bareMethod:
        'RPC 方法名 "{{name}}" 缺少模块前缀。必须使用 "module.action" 格式，如 "{{suggestion}}"。',
      invalidFormat:
        'RPC 方法名 "{{name}}" 格式错误。必须使用 "module.action" 格式（单一 "." 分隔）。',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // 只检查 .ts 和 .tsx 文件
    if (!/\.[jt]sx?$/.test(filename)) return {};

    return {
      CallExpression(node) {
        const { callee, arguments: args } = node;

        // 获取调用名称字符串
        let calleeText = "";
        if (callee.type === "Identifier") {
          calleeText = callee.name;
        } else if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
          calleeText = `.${callee.property.name}`;
        }

        for (const pattern of METHOD_CALL_PATTERNS) {
          if (!pattern.calleePattern.test(calleeText)) continue;
          if (args.length <= pattern.argIndex) continue;

          const arg = args[pattern.argIndex];
          if (arg.type !== "Literal" || typeof arg.value !== "string") continue;

          const methodName = arg.value;

          // 检查是否包含点
          if (!methodName.includes(".")) {
            // 猜测建议的模块前缀
            const suggestion = `module.${methodName}`;
            context.report({
              node: arg,
              messageId: "bareMethod",
              data: { name: methodName, suggestion },
            });
          } else if (!isModuleMethodName(methodName)) {
            // 包含点但格式不对（多个点、开头/结尾有点等）
            context.report({
              node: arg,
              messageId: "invalidFormat",
              data: { name: methodName },
            });
          }
        }
      },
    };
  },
};
