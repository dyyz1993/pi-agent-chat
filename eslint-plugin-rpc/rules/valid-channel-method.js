/**
 * @fileoverview Validate callChannel() method names against known channel contracts
 *
 * Ensures that every callChannel(sessionId, channelName, methodName, ...) call
 * uses a method name that the backend extension actually registers via channel.handle().
 *
 * Method names are read from src/shared/constants/channel-methods.ts at lint time.
 */

"use strict";

const path = require("path");
const fs = require("fs");

let cachedMethods = null;
// Invalidate cache when this module is reloaded


/**
 * Parse the channel-methods.ts file to extract valid method names.
 * Simple regex-based parser — looks for string values like "something.something".
 */
function loadChannelMethods(rootDir) {
  if (cachedMethods) return cachedMethods;

  const constantsPath = path.join(rootDir, "src/shared/constants/channel-methods.ts");
  if (!fs.existsSync(constantsPath)) {
    return { allMethods: new Set() };
  }

  const content = fs.readFileSync(constantsPath, "utf-8");

  const methodRegex = /["']([a-zA-Z][a-zA-Z0-9_.-]+)["']/g;
  const allMethods = new Set();
  let match;
  while ((match = methodRegex.exec(content)) !== null) {
    allMethods.add(match[1]);
  }

  cachedMethods = { allMethods };
  return cachedMethods;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "callChannel() 方法名必须在已知 channel contract 中定义",
      category: "RPC Conventions",
      recommended: "error",
    },
    messages: {
      unknownMethod:
        'callChannel() 方法名 "{{method}}" 不在已知 channel contract 中。' +
        "请检查 src/shared/constants/channel-methods.ts 中的定义，或确认后端 extension 注册了此方法。",
      missingConstants:
        "找不到 src/shared/constants/channel-methods.ts，跳过 callChannel 方法名校验。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();
    if (!/\.[jt]sx?$/.test(filename)) return {};

    let rootDir = context.getCwd?.() || process.cwd();

    const { allMethods } = loadChannelMethods(rootDir);

    if (allMethods.size === 0) {
      return {};
    }

    return {
      CallExpression(node) {
        const { callee, arguments: args } = node;

        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.property.name !== "callChannel"
        ) {
          return;
        }

        if (args.length < 3) return;

        const methodArg = args[2];
        if (methodArg.type !== "Literal" || typeof methodArg.value !== "string") return;

        const methodName = methodArg.value;

        if (!allMethods.has(methodName)) {
          context.report({
            node: methodArg,
            messageId: "unknownMethod",
            data: { method: methodName },
          });
        }
      },
    };
  },
};
