/**
 * eslint-plugin-rpc — RPC 模块化规范 ESLint 插件（单注册架构）
 *
 * 规则列表：
 *   - rpc/no-bare-method          : 方法名必须使用 module.action 格式
 *   - rpc/no-direct-register      : server.register() 只允许在 handlers/ 目录内使用
 *   - rpc/schema-merge-only       : rpc-schema.ts 禁止直接定义方法
 *   - rpc/module-file-naming      : 模块文件命名、导出、方法前缀强制规范
 *   - rpc/require-typed-register  : 入口文件必须导入 registerAllHandlers
 *   - rpc/require-api-client      : 前端必须通过 apiClient 调用 RPC
 *   - rpc/no-namespace-iterate    : 禁止 Object.values() 遍历 namespace import
 *   - rpc/no-component-rpc-fetch  : 禁止 UI 组件直接调用 apiClient.call() 获取共享数据
 *   - rpc/valid-channel-method      : callChannel() 方法名必须在已知 channel contract 中定义
 *   - rpc/compaction-entries-sync   : JSONL 解析中 compaction 必须同时 push 到 allCompactionEntries + allMessages
 *   - rpc/compaction-reload-pairing : compactionDeferredSessions.add() 必须有 agent_end 兜底 flush
 */
"use strict";

const noBareMethod = require("./rules/no-bare-method");
const noDirectRegister = require("./rules/no-direct-register");
const schemaMergeOnly = require("./rules/schema-merge-only");
const moduleFileNaming = require("./rules/module-file-naming");
const requireTypedRegister = require("./rules/require-typed-register");
const requireApiClient = require("./rules/require-api-client");
const noNamespaceIterate = require("./rules/no-namespace-iterate");
const noComponentRpcFetch = require("./rules/no-component-rpc-fetch");
const validChannelMethod = require("./rules/valid-channel-method");
const compactionEntriesSync = require("./rules/compaction-entries-sync");
const compactionReloadPairing = require("./rules/compaction-reload-pairing");

module.exports = {
  meta: {
    name: "eslint-plugin-rpc",
    version: "1.0.0",
  },
  rules: {
    "no-bare-method": noBareMethod,
    "no-direct-register": noDirectRegister,
    "schema-merge-only": schemaMergeOnly,
    "module-file-naming": moduleFileNaming,
    "require-typed-register": requireTypedRegister,
    "require-api-client": requireApiClient,
    "no-namespace-iterate": noNamespaceIterate,
    "no-component-rpc-fetch": noComponentRpcFetch,
    "valid-channel-method": validChannelMethod,
    "compaction-entries-sync": compactionEntriesSync,
    "compaction-reload-pairing": compactionReloadPairing,
  },
  configs: {
    recommended: {
      plugins: ["rpc"],
      rules: {
        "rpc/no-bare-method": "error",
        "rpc/no-direct-register": "error",
        "rpc/schema-merge-only": "error",
        "rpc/module-file-naming": "error",
        "rpc/require-typed-register": "error",
        "rpc/require-api-client": "error",
        "rpc/no-namespace-iterate": "error",
        "rpc/no-component-rpc-fetch": "warn",
        "rpc/valid-channel-method": "error",
        "rpc/compaction-entries-sync": "error",
        "rpc/compaction-reload-pairing": "error",
      },
    },
  },
};
