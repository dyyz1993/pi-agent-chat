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
 */
"use strict";

const noBareMethod = require("./rules/no-bare-method");
const noDirectRegister = require("./rules/no-direct-register");
const schemaMergeOnly = require("./rules/schema-merge-only");
const moduleFileNaming = require("./rules/module-file-naming");
const requireTypedRegister = require("./rules/require-typed-register");
const requireApiClient = require("./rules/require-api-client");

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
      },
    },
  },
};
