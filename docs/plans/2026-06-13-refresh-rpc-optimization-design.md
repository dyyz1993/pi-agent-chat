# 刷新流程 RPC 调用优化方案

## 现状

用户刷新页面时，恢复一个活跃对话会触发约 **44 个 RPC 调用**（含 16 个 WebSocket 订阅 + 28 个请求调用）。其中包含重复调用、非首屏必要调用、可合并调用。

**目标**：首屏 RPC 减少到 ~17 个，总调用减少到 ~25 个。

---

## 优化项一览

| #   | 优化项                                | 类型 | 节省 RPC 数  | 风险 |
| --- | ------------------------------------- | ---- | ------------ | ---- |
| O1  | 消除 `project.syncTabs` 重复          | 去重 | 1            | 低   |
| O2  | 消除 `supervisor.fetchStatus` 重复    | 去重 | 1            | 低   |
| O3  | 消除 `agent.getContextUsage` 二次调用 | 去重 | 1            | 低   |
| O4  | 条件跳过 `_backgroundRefreshMessages` | 去重 | 1            | 低   |
| O5  | 延迟 fetchInitialState P3-P5          | 延迟 | 首屏 -12     | 低   |
| O6  | 延迟 memory 订阅                      | 延迟 | 首屏 -9 订阅 | 低   |
| O7  | localStorage 缓存 modelFavorites      | 缓存 | 1            | 低   |
| O8  | 合并 StatusPanel 批量接口             | 合并 | -4           | 中   |
| O9  | 合并 Agent 批量接口                   | 合并 | -2           | 中   |

---

## O1: 消除 `project.syncTabs` 重复

**现状**：`addProjectTab()` 调用 `syncTabsToBackend()`，将 tabs 同步回服务器。但刷新场景中 `restoreTabs` 刚从服务器读出这些 tabs，立刻又同步回去是多余的。

**方案**：在 `addProjectTab` 增加 `skipSync` 选项，`restore-flow.ts` 中调用时传 `true`。

**改动文件**：

- `src/mainview/stores/use-session-store.ts` — `addProjectTab` 增加 `skipSync` 参数
- `src/mainview/lib/restore-flow.ts` — 传递 `skipSync: true`

```ts
// use-session-store.ts
addProjectTab: (tab, opts?: { skipSync?: boolean }) => {
  // ... existing logic
  if (!opts?.skipSync) {
    syncTabsToBackend(nextTabs, activeProjectId);
  }
};

// restore-flow.ts
addProjectTab({ id: t.id, name: t.name, path: t.path }, { skipSync: true });
```

---

## O2: 消除 `supervisor.fetchStatus` 重复

**现状**：

- `session-subscriptions.ts:695` — supervisor 订阅成功后调 `fetchStatus(id)`
- `session-initial-state.ts:471` — P4 阶段又调 `supervisorStore.fetchStatus(sessionId)`

**方案**：从 fetchInitialState P4 中移除 `supervisor.fetchStatus`，仅保留订阅回调中的那次。

**改动文件**：

- `src/mainview/stores/session-initial-state.ts` — 删除 P4 中的 supervisor 调用

---

## O3: 消除 `agent.getContextUsage` 二次调用

**现状**：

- `fetchInitialState` P2 阶段调用一次（带重试）
- `session-active-session.ts` COLD/HOT 路径在 `_backgroundRefreshMessages` 完成后又调一次

**方案**：fetchInitialState P2 的 `getContextUsage` 结果写入 store 后，COLD/HOT 后续路径检查 store 中是否已有有效值（`tokens != null`），有则跳过二次调用。

**改动文件**：

- `src/mainview/stores/session-active-session.ts` — 在二次调用前检查缓存

```ts
// COLD path: 替换 agent.getContextUsage 调用
.then(() => {
  const ctx = get().sessionContextBySession?.[id];
  if (ctx?.tokens != null) return; // 已有有效值，跳过
  return apiClient.call("agent.getContextUsage", { sessionId: id })
    .then(...)
    .catch(() => {});
})
```

---

## O4: 条件跳过 `_backgroundRefreshMessages`

**现状**：COLD 路径中 `loadSessionMessages` (从 JSONL 加载) 完成后，又调 `_backgroundRefreshMessages` (再次 `getFullMessages`)。这两个调用间隔很短（通常 <1s），数据几乎无变化。

**方案**：如果 `loadSessionMessages` 返回的消息已经包含 assistant 消息（有 `tokenUsage`），且 agent 状态为 idle，跳过 `_backgroundRefreshMessages`。只在 streaming 场景下才做二次刷新。

**改动文件**：

- `src/mainview/stores/session-active-session.ts` — 增加条件判断

```ts
// COLD path: 替换无条件 _backgroundRefreshMessages
const msgs = useChatStore.getState().messagesBySession[id] || [];
const status = get().sessionStatusMap[id];
const needsRefresh =
  status === "streaming" || !msgs.some((m) => m.role === "assistant" && m.tokenUsage);
if (needsRefresh) {
  await useChatStore.getState()._backgroundRefreshMessages(id, session.sessionPath);
}
```

---

## O5: 延迟 fetchInitialState P3-P5

**现状**：fetchInitialState 按 P1→P2→P3→P4→P5 顺序串行等待，总共 17 个 RPC。其中 P3-P5（12 个 RPC）的数据不参与首屏渲染。

**方案**：将 fetchInitialState 拆分为 `fetchCriticalState`（P1+P2，首屏）和 `fetchDeferredState`（P3+P4+P5，延迟）。延迟逻辑：

1. `fetchCriticalState` 在 `agent.start` 完成后立即执行（不变）
2. `fetchDeferredState` 在以下任一条件触发：
   - Agent 状态变为 idle（`agent_end` 事件到达）
   - 距 `agent.start` 完成 2 秒后（兜底，防止 agent 一直 streaming）
   - 用户主动打开 StatusPanel / AgentPanel

**改动文件**：

- `src/mainview/stores/session-initial-state.ts` — 拆分函数，导出 `fetchCriticalState` + `fetchDeferredState`
- `src/mainview/stores/session-active-session.ts` — 调用 `fetchCriticalState`，注册延迟触发器
- `src/mainview/stores/agent-event-handler.ts` — 在 `agent_end` 事件中触发 `fetchDeferredState`

```
fetchInitialState(sessionId)
  ├─ fetchCriticalState(sessionId)     ← agent.start 完成后立即
  │    ├─ P1: agent.getState
  │    └─ P2: getAvailableModels + getContextUsage + getSettings
  │
  └─ fetchDeferredState(sessionId)    ← idle 后 2s 或用户打开面板
       ├─ P3: getExtensions + getDisabledPlugins + getSkills + getDisabledSkills
       ├─ P4: getMcpServers + getQueue + getLatestAgentChange
       └─ P5: getAgents + getCurrentAgent + getTierModels + getModelFavorites + loadTierConfig
```

---

## O6: 延迟 memory 订阅

**现状**：`setupSubscriptions` 中注册 9 个 memory 相关订阅（bookmark_creating, updated, update_failed, prefetch, prefetch_result, extract, extract_result, dream, dream_result），全部在 session 切换时立即执行。

**方案**：将 memory 订阅从 `setupSubscriptions` 中提取出来，改为延迟注册：

1. `setupSubscriptions` 只注册核心订阅（agent, subagent, bash, lsp, rules, notify, coordinator, supervisor）
2. Memory 订阅在 `fetchDeferredState` 触发时一并注册

**改动文件**：

- `src/mainview/stores/session-subscriptions.ts` — 提取 `setupMemorySubscriptions(id, session)` 为独立函数
- `src/mainview/stores/session-initial-state.ts` — `fetchDeferredState` 中调用 `setupMemorySubscriptions`

---

## O7: localStorage 缓存 modelFavorites

**现状**：`project.getModelFavorites` 每次刷新都调 RPC 获取，但 `modelFavorites` 已经在 `use-session-store` 的 `persist` 中间件中持久化到 localStorage。

**方案**：fetchInitialState P5 中的 `project.getModelFavorites` 调用前，先检查 store 中 `modelFavorites.size > 0`，有则跳过。

**改动文件**：

- `src/mainview/stores/session-initial-state.ts` — 增加缓存检查

```ts
if (get().modelFavorites.size === 0) {
  favoritesPromise = apiClient.call("project.getModelFavorites", {});
} else {
  favoritesPromise = Promise.resolve(null); // 跳过
}
```

---

## O8: 合并 StatusPanel 批量接口

**现状**：5 个独立 RPC 获取状态面板数据：

- `agent.getExtensions`
- `agent.getDisabledPlugins`
- `agent.getSkills`
- `agent.getDisabledSkills`
- `agent.getMcpServers`

**方案**：新增 `agent.getStatusPanelData` RPC，一次返回全部数据。

**改动文件**：

- `src/shared/modules/agent.ts` — 新增类型定义
- `src/shared/handlers/agent.ts` — 新增 handler（聚合 5 个 CLI channel 调用）
- `src/mainview/stores/session-initial-state.ts` — 替换 5 个调用为 1 个

```ts
// agent.ts 新增
"agent.getStatusPanelData": {
  params: { sessionId: string; projectPath: string };
  result: {
    extensions: Array<{...}>;
    disabledPlugins: string[];
    skills: Array<{...}>;
    disabledSkills: string[];
    mcpServers: Array<{...}>;
  };
};
```

---

## O9: 合并 Agent 批量接口

**现状**：3 个独立 RPC：

- `agent.getAgents`
- `agent.getCurrentAgent`
- `agent.getLatestAgentChange`

**方案**：新增 `agent.getAgentInfo` RPC。

```ts
"agent.getAgentInfo": {
  params: { sessionId: string };
  result: {
    agents: Array<{...}>;
    currentAgentName: string | null;
    latestChange: { agentName: string; timestamp: string } | null;
  };
};
```

---

## 优化前后对比

### 首屏加载（用户可感知延迟）

| 阶段                          | 优化前          | 优化后          |
| ----------------------------- | --------------- | --------------- |
| WebSocket 连接                | 1               | 1               |
| 全局订阅                      | 2               | 2               |
| restoreTabs + scanSessions    | 3               | 2 (去 syncTabs) |
| 核心订阅 (agent/bash/rules等) | 7 订阅 + 3 历史 | 7 订阅 + 3 历史 |
| agent.getFullMessages         | 1               | 1               |
| agent.start                   | 1               | 1               |
| fetchCriticalState (P1+P2)    | 4               | 4               |
| **首屏总计**                  | **~22**         | **~20**         |

### 延迟加载（idle 后 2s 或用户触发）

| 阶段                             | 优化前   | 优化后                              |
| -------------------------------- | -------- | ----------------------------------- |
| P3: StatusPanel (5→1)            | 5        | 1 (合并后)                          |
| P4: Queue/AgentChange/Supervisor | 3        | 2 (去 supervisor 重复)              |
| P5: Agent/Tier/Favorites (3→1)   | 3        | 1 (合并后) + 1 (favorites 缓存跳过) |
| memory 订阅                      | 9 (立即) | 9 (延迟)                            |
| **延迟总计**                     | **20**   | **~13**                             |

### 总计

| 指标     | 优化前       | 优化后                     | 改善        |
| -------- | ------------ | -------------------------- | ----------- |
| 首屏 RPC | ~22          | ~20                        | -9%         |
| 延迟 RPC | ~20          | ~13                        | -35%        |
| 总 RPC   | ~44          | ~33                        | -25%        |
| 串行等待 | P1→P5 全串行 | P1→P2 串行，P3→P5 延迟并行 | 首屏快 ~60% |

---

## 实施优先级

### P0（低风险，高收益，立即做）

1. **O1**: 去除 syncTabs 重复
2. **O2**: 去除 supervisor.fetchStatus 重复
3. **O3**: 去除 getContextUsage 重复
4. **O7**: modelFavorites 缓存检查

### P1（中风险，高收益）

5. **O5**: fetchInitialState 拆分 critical/deferred
6. **O4**: 条件跳过 \_backgroundRefreshMessages
7. **O6**: 延迟 memory 订阅

### P2（需要改 RPC 接口定义，可后续做）

8. **O8**: StatusPanel 批量接口
9. **O9**: Agent 批量接口

---

## 风险与回退

| 风险                                 | 影响                      | 缓解                                                         |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------ |
| O5 延迟加载导致 StatusPanel 初始为空 | 用户打开面板时数据未就绪  | 面板打开时主动触发 `fetchDeferredState`，加 loading skeleton |
| O6 延迟 memory 订阅导致错过事件      | memory 更新不在时间线显示 | `fetchDeferredState` 触发时同步调 `memory.loadFiles` 补数据  |
| O8/O9 合并接口后端出错               | 单个接口失败影响更多数据  | 降级为独立调用（try-catch fallback）                         |

---

## 测试策略

1. **单元测试**：`test/unit/stores/session-initial-state.test.ts` — 验证 critical/deferred 拆分逻辑
2. **集成测试**：`test/integration/session/` — 验证刷新恢复完整流程
3. **回归测试**：`test/regression/` — 确保以下场景不受影响：
   - 刷新时 agent 正在 streaming
   - 刷新时 agent 正在 compacting
   - WebSocket 断线重连（不走刷新路径）
   - 多 tab 切换场景
4. **手动验证**：Chrome DevTools Network tab 计数 RPC 调用数量
