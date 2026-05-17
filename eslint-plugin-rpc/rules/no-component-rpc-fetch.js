/**
 * @fileoverview 禁止 UI 组件直接调用 apiClient.call() 获取共享只读数据
 *
 * 共享数据的 RPC 调用必须放在 Store actions 中（stores/*.ts），
 * 禁止在 src/mainview/components/ 下的 UI 组件中直接调用这些 getter。
 *
 * 只检测已知属于 fetchInitialState 的共享只读 getter 方法：
 *   agent.getAgents, agent.getCurrentAgent, agent.getLatestAgentChange
 *   agent.getState, agent.getAvailableModels, agent.getTierModels
 *   agent.getExtensions, agent.getSkills, agent.getMcpServers
 *   agent.getQueue, agent.getContextUsage, agent.getDisabledSkills
 *
 * 用户触发的写操作（send, switchAgent, setModel 等）不在检测范围内。
 */

"use strict";

const SHARED_GETTER_METHODS = new Set([
  "agent.getAgents",
  "agent.getCurrentAgent",
  "agent.getLatestAgentChange",
  "agent.getState",
  "agent.getAvailableModels",
  "agent.getTierModels",
  "agent.getExtensions",
  "agent.getSkills",
  "agent.getMcpServers",
  "agent.getQueue",
  "agent.getContextUsage",
  "agent.getDisabledSkills",
  "agent.getAllTools",
  "agent.getSystemPrompt",
  "agent.getAgentDetail",
  "session.getEntries",
  "memory.list",
  "rules.list",
  "snapshot.list",
  "bash.list",
  "lsp.status",
]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "禁止 UI 组件直接调用共享只读数据的 RPC getter",
      category: "Store-First",
      recommended: "error",
    },
    messages: {
      noComponentRpcFetch:
        "共享数据 '{{method}}' 的获取必须在 Store action 中（stores/*.ts），不应在 UI 组件中直接调用。请移至 fetchInitialState 或专用 store action。",
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    // Only check files under src/mainview/components/
    if (!/src\/mainview\/components\/.*\.[jt]sx?$/.test(filename)) return {};

    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          node.callee.object.name === "apiClient" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "call" &&
          node.arguments.length > 0
        ) {
          const firstArg = node.arguments[0];
          if (
            firstArg.type === "Literal" &&
            typeof firstArg.value === "string" &&
            SHARED_GETTER_METHODS.has(firstArg.value)
          ) {
            context.report({
              node,
              messageId: "noComponentRpcFetch",
              data: { method: firstArg.value },
            });
          }
        }
      },
    };
  },
};
