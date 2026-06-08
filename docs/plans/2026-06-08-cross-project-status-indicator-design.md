# 跨项目会话状态指示器

> 状态：待实施
> 日期：2026-06-08
> 影响范围：`TabBar.tsx`、`use-session-store.ts`、相关测试
> 前置依赖：无

## 问题现象

用户刷新或重新进入应用时，**只有当前活跃项目** 的会话状态指示器（TabBar 上的圆点颜色、权限待办角标）能正确反映运行中/等待权限等状态。**其他非活跃项目** 的指示器会保持绿色（idle），即使这些项目里其实有会话正在 streaming、compacting、retrying 或等待权限审批。

期望行为：进入应用后，所有项目的 TabBar 指示器都能即时反映出真实状态；之后任一会话的状态变化也要能通过推送实时更新到对应 Tab 上。

## 根因分析

### 现状链路

```
App 启动
  ├─ setupProjectStatusSubscription()  ← 注册了 agent.session_status_changed 订阅
  └─ restore 流程
       ├─ 加载活跃项目的 sessions 列表
       └─ 1200ms 后 fetchAllProjectsSessionsStatus()
             └─ 此时 sessionsByProject 里只有活跃项目，所以批量接口只查了活跃项目

TabBar 初始化（3 秒延迟）
  └─ 加载非活跃项目的 sessions 列表  ← 没有触发 status 拉取
```

### 关键观察

1. **服务端已有** `broadcastSessionStatus` 通道（`process-manager.ts:440-453`），每次状态变化都会广播 `agent.session_status_changed`。
2. **前端已有** `setupProjectStatusSubscription` 订阅回调（`session-subscriptions.ts:929-944`），会写入 `sessionStatusMap`。
3. **批量拉取已有** `fetchAllProjectsSessionsStatus` 方法（`use-session-store.ts:819-833`），依赖 `agent.batchGetSessionsStatus`。
4. **Bug 在哪**：`TabBar.tsx:84-103` 的 3 秒 init effect 加载完非活跃项目的 session 列表后，**没有触发** 批量 status 拉取。这些 session 在 `sessionStatusMap` 里始终是 `undefined`，`TabBar.resolveDotClass` 找不到匹配就 fallback 到绿色。

### `resolveDotClass` 行为回顾

```typescript
function resolveDotClass(sessions, statusMap) {
  for (const s of sessions) {
    const st = statusMap[s.sessionId];
    if (st === "permission" || st === "retrying") return "bg-status-error";
    if (st === "streaming" || st === "compacting") return "bg-status-warning animate-pulse";
  }
  return "bg-status-success";   // ← 现状：非活跃项目一直走到这里
}
```

`hasPermissionPending` 也有同样问题：它依赖 `sessionStatusMap[s.sessionId] === "permission"`，status 为空时不会渲染角标。

## 设计方案

### 核心思路

**两层保证**：

1. **拉一次（one-shot batch）**：在 TabBar 加载完所有非活跃项目的 session 列表后，调用 `fetchAllProjectsSessionsStatus()`，把它们的真实状态拉下来填进 `sessionStatusMap`。
2. **实时推送（push subscription）**：依赖已有的 `setupProjectStatusSubscription`，覆盖后续所有跨项目状态变化。`sessionStatusMap` 一旦更新，TabBar 的 `resolveDotClass` / `hasPermissionPending` 自动重渲染（因为它们在 store selector 范围内）。

### 改动点

#### 1. `TabBar.tsx` init effect 末尾追加批量拉取

```typescript
// TabBar.tsx:84-103
useEffect(() => {
  if (initializedRef.current) return;
  initializedRef.current = true;

  const timer = setTimeout(async () => {
    try {
      const tabsToInit = projectTabs.filter((tab) => !sessionsByProject[tab.path]);
      if (tabsToInit.length > 0) {
        await Promise.all(tabsToInit.map((tab) => loadSessionsForProject(tab.path)));
      }
      // NEW: 加载完所有项目列表后，立刻批量拉一次真实状态
      useSessionStore.getState().fetchAllProjectsSessionsStatus();
    } catch (err) {
      log.error("[TabBar] Failed to initialize projects:", { ... });
    }
  }, 3000);

  return () => clearTimeout(timer);
}, [projectTabs, sessionsByProject, loadSessionsForProject]);
```

#### 2. `App.tsx` 现有 1200ms 调用保持不变

它作为「活跃项目快速通道」提前拉一次，让活跃项目的指示器在 1.2s 就位。TabBar 的 3s+ 调用是兜底，覆盖其他项目。

```typescript
// App.tsx:296-307（保持原样）
useEffect(() => {
  if (restoring || !ready) return;
  const timer = window.setTimeout(() => {
    useSessionStore.getState().fetchAllProjectsSessionsStatus().catch(...);
  }, 1200);
  return () => window.clearTimeout(timer);
}, [restoring, ready]);
```

### 数据流（修复后）

```
App 启动
  ├─ setupProjectStatusSubscription()  ← 实时推送通道就绪
  └─ restore 流程
       ├─ 加载活跃项目 sessions
       └─ 1200ms 后 fetchAllProjectsSessionsStatus()  ← 活跃项目状态就位

TabBar 初始化（3 秒延迟）
  ├─ 加载非活跃项目 sessions
  └─ 立刻 fetchAllProjectsSessionsStatus()  ← 所有项目状态就位

后续状态变化
  └─ 服务端 broadcast → setupProjectStatusSubscription 回调
       └─ updateSessionStatus(sid, status)
            └─ sessionStatusMap 更新 → TabBar 自动重渲染
```

### 边界情况

| 场景 | 行为 |
| ---- | ---- |
| `loadSessionsForProject` 部分失败 | 失败的项目不进 `sessionsByProject`，批量接口跳过它们；用户切到该项目时会自动触发 `fetchProjectSessionStatuses` |
| 用户在 3s 内切换项目 | `setActiveProject` 走自己的 `fetchProjectSessionStatuses`；TabBar init 的 `initializedRef` 守卫保证不会重跑，但 `sessionsByProject` 变化时不会再次触发（这是有意的，避免重复请求） |
| 用户在 3s 内关闭项目 | `removeProjectTab` 清理该 path 的 sessions；批量拉取会跳过它 |
| 推送事件先于 TabBar init 到达 | `setupProjectStatusSubscription` 已就绪，`sessionStatusMap` 会被正确写入；后续批量拉取会覆盖一遍，确保数据一致 |
| 后端没有该项目 | `agent.batchGetSessionsStatus` 跳过不存在的 sessionId；其他 session 正常更新 |

### 不做的事（YAGNI）

- **不做轮询**：`agent.session_status_changed` 已经覆盖实时更新，无需额外 setInterval。
- **不做 TabBar 上的状态徽标聚合**：现状的 dot + 权限角标已经够用，不引入数字徽标等新元素。
- **不做后端 schema 变更**：复用现有 `agent.session_status_changed` 事件。
- **不修改 `fetchAllProjectsSessionsStatus` 行为**：复用现有方法，调用时机调整即可。

## 测试计划

### 单元测试

#### T1. TabBar init 触发 `fetchAllProjectsSessionsStatus`

文件：`test/tabbar-init-fetch-status.test.tsx`

- mock `loadSessionsForProject` 立即 resolve
- mock `fetchAllProjectsSessionsStatus` 跟踪调用
- 渲染 TabBar，等待 3s + 跑完 microtask
- 断言 `fetchAllProjectsSessionsStatus` 被调用了一次

#### T2. TabBar 非活跃项目指示器随 status map 渲染

文件：`test/tabbar-status-indicator.test.tsx`

- 准备两个项目 A、B，A 是活跃项目，B 是非活跃
- 在 `sessionStatusMap` 里给 B 的某个 session 写入 `"streaming"`
- 渲染 TabBar
- 断言 B 项目的 tab 圆点 class 包含 `bg-status-warning` 和 `animate-pulse`

#### T3. TabBar 非活跃项目权限角标渲染

- 给非活跃项目 B 的 session 写入 `"permission"`
- 渲染 TabBar
- 断言 B 项目 tab 包含 `MessageCircleQuestion` 图标（mock 为 testid）

#### T4. 推送事件更新非活跃项目指示器

- 初始 `sessionStatusMap` 为空
- 渲染 TabBar，断言 B 项目 tab 是绿色
- 模拟 `setupProjectStatusSubscription` 回调收到 B 的 session `"streaming"` 事件
- 断言 TabBar 重渲染后 B 项目 tab 变黄色

### 集成验证（手动）

1. 开两个项目，都加载好
2. 让其中一个的会话进入 streaming
3. 切到另一个项目（不刷新）
4. TabBar 上原项目的 tab 应该实时显示黄色脉冲
5. F5 刷新页面
6. 刷新后两个项目的 tab 状态应立即可见（黄色和绿色）

## 实施步骤

1. 写 T1-T3 失败测试
2. 实施 `TabBar.tsx` 改动让 T1-T3 通过
3. 写 T4 失败测试，验证推送链路
4. 如有遗漏，补 `setupProjectStatusSubscription` 的覆盖
5. 跑全量测试，确保无回归
