---
description: "扫描组件中违反 Store-First 规范的代码（全局状态未走 Store、重复 RPC、useState 管理共享数据）"
agent: state-auditor
---

请对 pi-agent-chat 项目执行 Store-First 状态审计。

审计步骤：

1. 扫描 `src/mainview/components/` 中所有直接 `apiClient.call` 调用
2. 扫描所有组件内的 `useState` 判断是否为共享数据
3. 对比 `src/mainview/stores/` 中已有的 store action
4. 交叉比对，按规则输出违规报告

参考规范：`.opencode/rules/store-first-state-management.mdc`

输出格式：违规汇总表 + 每个违规的详情和修复方案 + 合规数据清单 + 修复优先级建议。
