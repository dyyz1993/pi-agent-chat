# 会话切换体验优化设计

> 状态：待实施
> 日期：2026-06-01
> 影响范围：`use-session-store.ts`、`use-chat-store.ts`、`session-subscriptions.ts`、`ChatPanel.tsx`
> 前置依赖：process-per-session Phase 1（已完成）

## 问题现象

1. **切换会话卡顿**：从 A 切到 B，再切回 A 时 UI 卡住数秒
2. **MessageList 闪烁**：切回 A 时消息列表先清空（白屏），再重新加载一遍
3. **多余的 RPC 调用**：即使进程还活着、消息已缓存，每次切换都走完整的启动链路

## 当前切换链路分析

```
用户点击切换 → setActiveSession(id)
  ├─ 1. sessionReady[id] = 保持原值（已修复，不再重置 false）
  ├─ 2. cleanupSessionLight(prevId)
  ├─ 3. set({ activeSessionId: id })           ← 触发 ChatPanel 重渲染
  ├─ 4. ensureSession()                         ← 异步，可能 loadSessionsForProject
  ├─ 5. setupSubscriptions(id)                  ← 注册 WebSocket 事件监听
  ├─ 6. agent.start RPC                         ← 后端：1ms(already_running) 或 5-15s(new)
  │    └─ sessionReady[id] = true
  ├─ 7. fetchInitialState(id)                   ← 3 批串行 RPC，共 ~9 个调用，2-5 秒
  │    ├─ P1: getState                          ← await 完成才继续
  │    ├─ P2: getAvailableModels + getContextUsage + getSettings  ← await allSettled
  │    └─ P3: getExtensions + getSkills + getDisabledSkills      ← await allSettled
  ├─ 8. replayHoldEvents（如果 already_running）
  └─ 9. loadSessionMessages(force: !hasCached)  ← 全量替换 messagesBySession[id]
       └─ 引用变了 → MessageList 完全重建 → 闪烁
```

### 关键时间节点

| 场景               | agent.start | fetchInitialState | loadMessages | 总计  | 用户感受       |
| ------------------ | ----------- | ----------------- | ------------ | ----- | -------------- |
| 热切换（进程活着） | 1ms         | 2-5s              | 0.5-2s       | 3-7s  | 卡顿+闪烁      |
| 冷切换（进程死了） | 5-15s       | 2-5s              | 0.5-2s       | 8-22s | 长时间 loading |

**问题核心：热切换和冷切换走的是同一条代码路径，但用户期望完全不同。**

## 根因分析

### 根因 1：不区分热/冷切换

每次切换都无条件执行完整的启动链路。Process-per-session Phase 1 之后，热切换时 `agent.start` 返回 `already_running`（1ms），但后续 `fetchInitialState` + `loadSessionMessages` 仍然全部执行。

### 根因 2：fetchInitialState 串行阻塞

3 批 RPC 串行等待，CLI 进程忙时每个 RPC 可能要排队。总共 ~9 个 RPC 调用。

但实际上大多数数据（模型列表、设置、扩展列表）在同一个 CLI 进程内不会因为切换会话而改变。不需要每次都重新拉取。

### 根因 3：loadSessionMessages 全量替换

`loadSessionMessages` 从服务器获取消息后，用 `hasSameIds`（ID 列表比对）判断是否需要更新。如果 ID 相同就跳过——这部分已经做了优化。

但当 `force: true` 时（本地没有缓存），会全量替换 `messagesBySession[id]`，触发 MessageList 完全重建。

### 根因 4：sessionReady 与消息数据不同步

`sessionReady = true` 在 step 6 就设了，但 `activeSessionId` 在 step 3 就变了。ChatPanel 在 step 3 就开始用新的 `activeSessionId` 去读 `messagesBySession`——此时消息可能还没加载完，显示空列表。

## 设计方案

### 核心理念：热切换零感知，冷切换优雅降级

```
                    ┌──────────────┐
  用户点击切换 ──→ │ 进程还活着？  │
                    └──────┬───────┘
                     yes ↙     ↘ no
              ┌──────────┐  ┌──────────────┐
              │ 热切换    │  │ 冷切换        │
              │（零延迟） │  │（完整启动链路）│
              └──────────┘  └──────────────┘
```

### 热切换（进程活着，already_running）

**目标**：用户感知不到任何延迟，消息列表无缝切换。

```
setActiveSession(id)
  ├─ 1. set({ activeSessionId: id })           ← UI 立即切换到已有消息
  ├─ 2. setupSubscriptions(id)                  ← 恢复事件监听
  ├─ 3. agent.start RPC                        ← 1ms, already_running
  ├─ 4. 后台静默刷新（不阻塞 UI）
  │    ├─ fetchInitialState（如果超过 30 秒没刷新过）
  │    └─ _backgroundRefreshMessages
  └─ 不设 sessionReady=false，不走 force loadMessages
```

关键改动：

- **不调 `cleanupSessionLight`**（或轻量调，只清理真正需要清理的）
- **不 force loadMessages**，走 `_backgroundRefreshMessages` 静默更新
- **`fetchInitialState` 加缓存 TTL**，30 秒内不重复拉取

### 冷切换（进程死了，需要新建）

**目标**：快速创建进程，优雅显示 loading 状态。

```
setActiveSession(id)
  ├─ 1. set({ activeSessionId: id, sessionReady[id]: false })
  ├─ 2. cleanupSessionLight(prevId)
  ├─ 3. setupSubscriptions(id)
  ├─ 4. agent.start RPC                        ← 5-15s，创建新进程
  │    └─ sessionReady[id] = true
  ├─ 5. fetchInitialState(id)（并行化优化）
  ├─ 6. loadSessionMessages(force: true)
  └─ 显示 loading → 消息加载完
```

### 如何判断热/冷

前端没有直接感知进程是否存在。方案：

**方案 A**：先调 `agent.getStatus(sessionId)` 探测（轻量 RPC）

- 返回非 stopped → 热切换
- 返回 stopped → 冷切换

**方案 B**：调 `agent.start` 看返回值

- `already_running` → 热切换（但已经走了启动链路）

**推荐方案 A**：先探测再决定走哪条路径。

### fetchInitialState 优化

1. **加全局缓存 TTL**：模型列表、设置、扩展列表等不因会话切换而变化的数据，30 秒内不重复拉取
2. **P2/P3 并行化**：当前 P2 和 P3 是串行的，但它们互不依赖，可以全并行

### loadSessionMessages 闪烁修复

1. 热切换时不调 `loadSessionMessages`，走 `_backgroundRefreshMessages`
2. `_backgroundRefreshMessages` 合并时用更精细的差异比对，避免全量替换
3. 如果确实需要全量替换，用 `requestAnimationFrame` 延迟一帧再更新 store，让 React 先渲染旧内容

## 实施计划

### Phase 1：热/冷切换分流（高优先）

1. 在 `setActiveSession` 开头加 `agent.getStatus` 探测
2. 热切换路径：跳过 cleanupSessionLight、不 force loadMessages、后台静默刷新
3. 冷切换路径：保持现有逻辑
4. 修改 `sessionReady` 策略：热切换不重置

### Phase 2：fetchInitialState 缓存（中优先）

1. 加 TTL 缓存，模型列表/设置/扩展 30 秒内复用
2. P2/P3 改为全并行

### Phase 3：MessageList 无闪烁（中优先）

1. `_backgroundRefreshMessages` 用差异更新而非全量替换
2. 如果 ID 列表相同但内容有差异（如 toolExecution 状态更新），只更新变化的条目

## 验证标准

1. **热切换**：A → B → A，消息列表无闪烁，无白屏，延迟 < 100ms
2. **冷切换**：切到未启动的会话，loading 状态清晰，完成后平滑过渡
3. **A streaming + 切到 B + 切回 A**：A 仍在 streaming，消息无丢失
4. **LRU 淘汰后切回**：优雅降级到冷切换，loading 状态清晰

## 相关文件

| 文件                                           | 作用                                    |
| ---------------------------------------------- | --------------------------------------- |
| `src/mainview/stores/use-session-store.ts`     | 切换主逻辑、fetchInitialState           |
| `src/mainview/stores/use-chat-store.ts`        | loadSessionMessages、backgroundRefresh  |
| `src/mainview/stores/session-subscriptions.ts` | setupSubscriptions、cleanupSessionLight |
| `src/mainview/components/chat/ChatPanel.tsx`   | sessionReady 控制 UI 状态               |
| `src/shared/agent/process-manager.ts`          | 后端 start/getStatus                    |
