# AgentConfig 字段 E2E 测试计划

## 需要测试的字段和 Case

每个字段分两类测试：

- **静态检查**：通过 RPC 读取状态验证（`getActiveTools`、`getSystemPrompt` 等）
- **行为验证**：实际发送消息，验证 Agent 行为是否符合配置

---

### 1. tools — 工具白名单

| #   | Case                                         | 验证方式                       | 状态    |
| --- | -------------------------------------------- | ------------------------------ | ------- |
| 1.1 | Build 初始有 edit/write/bash                 | `getActiveTools`               | ✅ 已测 |
| 1.2 | Plan 只有 read/grep/find/ls                  | `getActiveTools`               | ✅ 已测 |
| 1.3 | Plan→Build 后 edit/write/bash 恢复           | `getActiveTools`               | ✅ 已测 |
| 1.4 | Explore→Build 后全部恢复                     | `getActiveTools`               | ✅ 已测 |
| 1.5 | Build 聊天能成功创建文件                     | `agent.send` + `file.readFile` | ✅ 已测 |
| 1.6 | 多轮切换（Plan→Explore→Build×2）工具始终正确 | `getActiveTools`               | ✅ 已测 |

### 2. disallowedTools — 工具黑名单

| #   | Case                                        | 验证方式                              | 状态    |
| --- | ------------------------------------------- | ------------------------------------- | ------- |
| 2.1 | Explore disallowedTools=[edit,write] 生效   | `getActiveTools` 不含 edit/write      | ✅ 已测 |
| 2.2 | Plan disallowedTools=[edit,write,bash] 生效 | `getActiveTools` 不含 edit/write/bash | ✅ 已测 |
| 2.3 | Build 切换后黑名单清空                      | `getActiveTools` 含全部工具           | ✅ 已测 |

### 3. systemPrompt — 系统提示词

| #   | Case                                           | 验证方式                    | 状态    |
| --- | ---------------------------------------------- | --------------------------- | ------- |
| 3.1 | Build 默认含 "coding assistant"                | `getSystemPrompt`           | ✅ 已测 |
| 3.2 | Plan 含 "planning specialist"                  | `getSystemPrompt`           | ✅ 已测 |
| 3.3 | Explore 含 "exploration specialist"            | `getSystemPrompt`           | ✅ 已测 |
| 3.4 | Plan→Build 后 "planning specialist" 消失       | `getSystemPrompt`           | ✅ 已测 |
| 3.5 | Explore→Build 后 "exploration specialist" 消失 | `getSystemPrompt`           | ✅ 已测 |
| 3.6 | Plan 聊天时回复风格像 Plan（分析报告格式）     | `agent.send` + 检查回复内容 | ❌ 未测 |

### 4. thinkingLevel — 思考深度

| #   | Case                                 | 验证方式                                 | 状态    |
| --- | ------------------------------------ | ---------------------------------------- | ------- |
| 4.1 | Plan thinkingLevel="high" 生效       | `getState` 或检查消息中的 thinking block | ❌ 未测 |
| 4.2 | Plan→Build 后 thinkingLevel 恢复默认 | 检查 thinking block 消失或变 low         | ❌ 未测 |

### 5. maxTurns — 最大轮次限制

| #   | Case                                   | 验证方式                      | 状态    |
| --- | -------------------------------------- | ----------------------------- | ------- |
| 5.1 | 设置 maxTurns=2，Agent 执行 2 轮后停止 | `agent.send` + 检查 turn 数量 | ❌ 未测 |
| 5.2 | 切换到无 maxTurns 的 agent 后不再限制  | 同上                          | ❌ 未测 |

**验证方法**：创建自定义 agent（通过 RPC `switch_agent` 无法传 maxTurns，需要直接在 `applyAgentConfig` 场景下测试，或等自定义 agent 支持）。

**替代方案**：通过 JSONL 验证 `agent_change` entry 中包含 `maxTurns` 字段。

### 6. effort — 投入度

| #   | Case                                                   | 验证方式          | 状态    |
| --- | ------------------------------------------------------ | ----------------- | ------- |
| 6.1 | effort="low" 时 system prompt 含 "Effort Level: Low"   | `getSystemPrompt` | ❌ 未测 |
| 6.2 | effort="high" 时 system prompt 含 "Effort Level: High" | `getSystemPrompt` | ❌ 未测 |
| 6.3 | 切回无 effort 的 agent 后提示词消失                    | `getSystemPrompt` | ❌ 未测 |

**问题**：内置 agent 都没定义 effort，需要自定义 agent 才能测。可以在 JSONL 中验证，或者直接验证 `_rebuildSystemPrompt` 的输出。

### 7. skills — 技能过滤

| #   | Case                                                  | 验证方式          | 状态    |
| --- | ----------------------------------------------------- | ----------------- | ------- |
| 7.1 | 定义 skills=["skill-a"] 后 system prompt 只含该 skill | `getSystemPrompt` | ❌ 未测 |
| 7.2 | 切回无 skills 限制的 agent 后全部 skill 恢复          | `getSystemPrompt` | ❌ 未测 |

**问题**：同 effort，需要自定义 agent。先验证 JSONL 持久化。

### 8. paths — 路径限制

| #   | Case                                         | 验证方式                               | 状态    |
| --- | -------------------------------------------- | -------------------------------------- | ------- |
| 8.1 | paths.write 限制到子目录，写入该目录成功     | `agent.send` 让 Agent write 到允许路径 | ❌ 未测 |
| 8.2 | paths.write 限制到子目录，写入其他目录被拒绝 | `agent.send` 让 Agent write 到禁止路径 | ❌ 未测 |
| 8.3 | paths.read 限制后只能读指定目录              | `agent.send` 让 Agent read 禁止路径    | ❌ 未测 |
| 8.4 | 切换回无 paths 限制的 agent 后路径限制消失   | 同 8.2 验证不再被拒                    | ❌ 未测 |

**验证方法**：这需要自定义 agent 定义 paths。可以通过 `agent.getAgentDetail` 查看当前 agent 配置，然后 `agent.send` 触发实际操作。

### 9. hooks — 钩子

| #   | Case                             | 验证方式                        | 状态    |
| --- | -------------------------------- | ------------------------------- | ------- |
| 9.1 | hooks 写入 currentAgentVariables | `agent.getState` 检查 variables | ❌ 未测 |
| 9.2 | 扩展能读到 hooks 变量            | 需要扩展配合，暂时跳过          | N/A     |

### 10. JSONL 持久化 — agent_change entry

| #    | Case                                                      | 验证方式      | 状态      |
| ---- | --------------------------------------------------------- | ------------- | --------- |
| 10.1 | 每次切换都写入 agent_change entry                         | 读 JSONL 文件 | ✅ 已测   |
| 10.2 | entry 包含正确字段（name, tools, tier, thinkingLevel 等） | 读 JSONL 文件 | ✅ 部分测 |
| 10.3 | maxTurns/effort/skills 出现在 entry 中                    | 读 JSONL 文件 | ❌ 未测   |
| 10.4 | 最后一个 agent_change 是最终 agent                        | 读 JSONL 文件 | ✅ 已测   |

### 11. Session 恢复

| #    | Case                                        | 验证方式                             | 状态    |
| ---- | ------------------------------------------- | ------------------------------------ | ------- |
| 11.1 | 切到 Plan → 停止进程 → 重启 → 验证仍是 Plan | `agent.start` + `getCurrentAgent`    | ❌ 未测 |
| 11.2 | 重启后 Plan 的工具和提示词正确              | `getActiveTools` + `getSystemPrompt` | ❌ 未测 |
| 11.3 | 重启后切到 Build，工具和提示词正确恢复      | 同上                                 | ❌ 未测 |

---

## 实现优先级

### 立即可做（内置 agent 就能测）

- Case 1.x (tools) — ✅ 已完成
- Case 2.x (disallowedTools) — ✅ 已完成
- Case 3.x (systemPrompt) — 大部分已完成
- Case 4.x (thinkingLevel) — 需要验证方法
- Case 10.x (JSONL) — 部分已完成

### 需要自定义 agent（通过文件定义）

- Case 5.x (maxTurns) — 在 .pi/agents/ 下创建测试用 agent
- Case 6.x (effort) — 同上
- Case 7.x (skills) — 同上
- Case 8.x (paths) — 同上

### 需要进程重启

- Case 11.x (session 恢复) — 停止→启动→验证

---

## 自定义 Agent 测试方案

在临时目录创建 `.pi/agents/test-restricted.md`：

```markdown
---
name: test-restricted
description: Test agent with maxTurns, effort, skills, paths
tools:
  - read
  - write
  - bash
maxTurns: 3
effort: low
paths:
  write:
    - /tmp/e2e-test-xxx/allowed/
  read:
    - /tmp/e2e-test-xxx/
---

You are a test agent with restrictions.
Only write to the allowed directory.
```

然后通过 RPC `agent.switchAgent` 切到这个 agent，逐项验证。
