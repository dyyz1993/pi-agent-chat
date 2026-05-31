# Process-Per-Session 架构改造方案

> 状态：设计阶段，待实施
> 日期：2026-06-01
> 影响范围：`pi-agent-chat/src/shared/agent/process-manager.ts` + `pi-momo-fork`

## 问题背景

当前 `processByCwd` 按 cwd → 单个 CLI 进程映射。同项目下多个用户会话共用一个 CLI 进程，通过 `switchSession` 切换。

**核心问题**：`switchSession` 内部调 `teardownCurrent()` 会中断正在运行的 agent loop。用户切走再切回时，运行中的任务丢失。

## 设计约束（来自需求讨论）

### 1. 每个活跃会话独立 CLI 进程

- 会话被用户点击打开后，才创建 CLI 进程（惰性启动）
- 仅展示在侧栏列表中但未被打开的会话，不启动进程
- 同项目下可以有多个 CLI 进程并行运行

### 2. 以项目为维度管理

- `processByCwd` 按 cwd 分组，存 `Set<ManagedClient>`
- 同项目下的所有进程在一个 Set 里，方便跨进程通信（delegate、steer 等）

### 3. 进程生命周期管理

- **创建时机**：用户点击会话时启动
- **销毁时机**：静默销毁已完成/已停止的会话进程（LRU 淘汰）
- **进程上限**：需要设定最大并行进程数（建议 5-8 个），超过时按 LRU 淘汰最久未活跃的进程
- **保留策略**：正在 streaming 的进程不可被淘汰

### 4. 性能考虑

- CLI 进程是重量级的（加载 extensions、MCP 连接、模型配置等），每个约 100-200MB 内存
- 需要监控进程资源占用
- LRU 淘汰策略要考虑：
  - streaming 的进程优先保留
  - delegate/subagent 进程不受用户会话淘汰影响
  - 最近活跃的会话优先保留

### 5. 跨进程通信

- delegate（coordinator）、subagent（sync）、fork 都用 `forceNewProcess: true` 创建独立进程
- 所有进程（包括 delegate/subagent）统一注册到 `processByCwd`
- 跨进程通信（steer、followUp、delegate_send）通过 `processByCwd` 路由，不再依赖 `parentChildMap` 硬找

## 现状分析

### 进程创建方式

| 场景                 | forceNewProcess | 注册到 processByCwd | 注册到 clients Map | 独立 CLI 进程       |
| -------------------- | --------------- | ------------------- | ------------------ | ------------------- |
| 用户手动创建会话     | false           | 是（覆盖旧的）      | 是                 | 否，复用同 cwd 进程 |
| 用户切换会话         | false           | 复用                | switchSession 更新 | 否，复用            |
| coordinator delegate | true            | **否**              | 是                 | 是                  |
| subagent (sync)      | true            | **否**              | 是                 | 是                  |
| fork                 | true            | **否**              | 是                 | 是                  |

### 类型声明不匹配

- 声明：`Map<string, Set<ManagedClient>>`
- 实际使用：当 `Map<string, ManagedClient>` 用（set 传单个，get 返回后当单个访问）

### 关键代码位置

**pi-agent-chat（前端 process-manager）**：

- `src/shared/agent/process-manager.ts:294` — processByCwd 声明
- `src/shared/agent/process-manager.ts:597` — 进程池查找逻辑
- `src/shared/agent/process-manager.ts:781` — 注册到进程池
- `src/shared/agent/process-manager.ts:3107` — handleCoordinatorDelegate
- `src/shared/agent/process-manager.ts:3228` — handleCoordinatorDelegateSync
- `src/shared/agent/process-manager.ts:3561` — handleCoordinatorDelegateFork

**pi-momo-fork（后端 CLI）**：

- `packages/coding-agent/src/core/agent-session-runtime.ts:193` — switchSession（含 teardownCurrent）
- `packages/coding-agent/src/core/agent-session-runtime.ts:154` — teardownCurrent

## 实施计划

### Phase 1：前端 process-manager 改造

**目标**：每个用户会话独立进程，不再依赖 switchSession。

**步骤**：

1. **修改 processByCwd 为真正的 Set**
   - `Map<string, Set<ManagedClient>>` 声明和实际使用对齐
   - 添加 `addToPool(poolKey, managed)` 和 `removeFromPool(poolKey, managed)` 方法

2. **修改 start() 逻辑**
   - 移除 switchSession 复用逻辑
   - 每次调用都创建新 CLI 进程（除非已有同一 sessionId 的进程）
   - 先检查 `clients.get(sessionId)` 是否已有进程（切回来的场景）

3. **实现 LRU 淘汰**
   - 在 `ManagedClient` 加 `lastActiveAt` 时间戳
   - 设定 MAX_POOL_SIZE（建议 5）
   - 创建新进程前检查是否超限，超限则淘汰最久未活跃的非 streaming 进程
   - 淘汰时调 `managed.client.stop()` + 清理资源

4. **所有进程统一注册到 processByCwd**
   - delegate/subagent/fork 创建后也注册到 processByCwd
   - 移除 `if (!options?.forceNewProcess)` 条件

5. **统一跨进程通信路由**
   - `handleCoordinatorCall` 通过 processByCwd 查找目标进程
   - 简化 `parentChildMap` 的查找逻辑

### Phase 2：后端改造（如需要）

- 如果 switchSession 仍需要（比如 delegate 切换 agent），保留但不用于用户会话切换
- 验证 teardownCurrent 不影响用户会话

## 测试验证计划

### Phase 1 测试

1. **基本功能**
   - [ ] 创建会话 A → 发消息 → 正常流式响应
   - [ ] 创建会话 B → 切到 B → B 正常工作
   - [ ] 切回 A → A 之前的状态保留（消息、上下文）

2. **并行运行**
   - [ ] 会话 A 正在 streaming → 切到会话 B → 发消息 → B 正常响应
   - [ ] 切回 A → A 仍在 streaming（或已完成，结果完整）
   - [ ] 两个会话同时 streaming → 都能收到各自的事件

3. **LRU 淘汰**
   - [ ] 打开 6 个会话（超过上限）→ 最早的空闲会话被淘汰
   - [ ] 被淘汰的会话点击后能重新启动
   - [ ] streaming 的会话不被淘汰

4. **Delegate/Subagent**
   - [ ] 发起 delegate → 独立进程创建 → 注册到 processByCwd
   - [ ] delegate 结束 → 进程被清理
   - [ ] subagent 并行运行 → 不影响主会话

5. **性能验证**
   - [ ] 5 个并行进程的内存占用记录
   - [ ] 切换会话的响应时间（应该比 switchSession 快，因为不需要 teardown）
   - [ ] 进程创建时间记录（首次 vs 缓存）

### Phase 2 测试

1. **跨进程通信**
   - [ ] delegate_send（steer 模式）→ 正确路由到父进程
   - [ ] delegate_send（followUp 模式）→ 正确路由
   - [ ] 跨项目 delegate → 进程在不同 cwd 下正常通信

2. **Fork**
   - [ ] 从 subagent fork → 独立进程 → 注册到 processByCwd

## 风险与注意事项

1. **内存压力**：CLI 进程较重，需要严格限制并行数。建议 MAX_POOL_SIZE = 5，可通过配置调整。
2. **进程泄漏**：需要确保异常退出时也能清理进程（crash、timeout 等）。
3. **向后兼容**：delegate/subagent 已用 forceNewProcess，改动应该兼容。但需要回归测试。
4. **沙盒模式**：sandbox 下进程按 userId 分组，需要确保改造后仍然正确。
5. **WebSocket 事件路由**：多个进程并行推送事件时，session-subscriptions 需要正确按 sessionId 过滤。
