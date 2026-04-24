# ESLint 规范规则

- 禁止使用 `/* eslint-disable */`、`// eslint-disable-next-line`、`// eslint-disable` 等 eslint 禁用注释
- 如需绕过 lint 规则，应从根源解决：
  - **no-console**: 使用项目自带的 `createLogger` (from `src/shared/lib/logger.ts`) 替代 console.log/warn/error
  - **no-unused-vars**: 删除未使用的变量/导入，或用 `_` 前缀标记有意忽略的参数
  - **其他规则**: 修正代码以符合规范，或在 eslint.config.mjs 中调整规则配置
- 如需新增日志模块，在 `src/shared/lib/logger.ts` 的 `LogModule` 类型中添加模块名
