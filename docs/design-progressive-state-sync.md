# 渐进式状态同步设计

> 目标：首次进入快速可用，切换项目/会话不卡，后台数据逐步到位，推送保证实时。

---

## 一、现状问题分析

### 1.1 首次加载

当前首次进入的完整调用链：

```
App.tsx useEffect
  ├─ initializeConnection()          → apiClient.initialize()
  ├─ setupProjectStatusSubscription()
  └─ restore 流程
       ├─ project.restoreTabs()      → 获取保存的 tabs
       ├─ setActiveProject()         → 清理旧 session + 加载新项目
       │    ├─ loadSessionsForProject()  → project.scanSessions (RPC，阻塞)
       │    └─ setActiveSession()
       │         ├─ ensureSession()      → 可能再次 loadSessionsForProject！
       │         ├─ setupSubscriptions()
       │         ├─ agent.start()        → 启动 agent 进程 (RPC，30s timeout)
       │         ├─ fetchInitialState()  → 15+ 个 RPC 调用串行批次
       │         │    ├─ P1: agent.getState
       │         │    ├─ P2: agent.getAvailableModels + getContextUsage + getSettings
       │         │    ├─ P3: agent.getExtensions + getSkills + getDisabledSkills
       │         │    ├─ P4: agent.getMcpServers + getQueue + getLatestAgentChange
       │         │    └─ P5: agent.getAgents + getCurrentAgent + getTierModels + ...
       │         ├─ loadSessionMessages()
       │         └─ replayHoldEvents()
       └─ 项目加载完毕
```

**问题**：

- 没有拉取其他 session 的运行状态（只在切换时才拉取当前 session 的状态）
- 恢复完成后，其他 tab 中后台跑着的 session 状态未知

### 1.2 切换项目卡顿

当前 `setActiveProject` 的调用链：

```
setActiveProject(newId)
  ├─ cleanupActiveSession(prevSessionId)   // 清理旧 session
  │    ├─ cleanupSession()                 // 取消订阅、关闭连接
  │    └─ cleanupSessionData()             // 清理 store 数据
  │
  ├─ setActiveProjectId(newId)
  │
  └─ loadSessionsForProject(tab.path)      // ⚠️ 每次都做 RPC 调用
       ├─ project.scanSessions()           // ⚠️ 阻塞式等待
       ├─ 去重 + 合并逻辑
       └─ setActiveSession(targetSession)
            ├─ ensureSession()             // ⚠️ 可能再次 scanSessions
            ├─ agent.start()               // ⚠️ 可能慢（启动进程）
            └─ fetchInitialState()          // ⚠️ 15+ RPC 调用
```

**瓶颈分析**：

| 步骤                       | 耗时估计   | 是否可优化      |
| -------------------------- | ---------- | --------------- |
| `cleanupActiveSession`     | <5ms       | ✅ 已经够快     |
| `project.scanSessions` RPC | 100-500ms  | ⚠️ **可缓存**   |
| `ensureSession` 二次 scan  | 0-500ms    | ⚠️ **冗余调用** |
| `agent.start`              | 200-2000ms | ✅ 必要开销     |
| `fetchInitialState` P1-P5  | 500-2000ms | ✅ 必要但可拆分 |
| `loadSessionMessages`      | 100-500ms  | ✅ 必要         |

**核心卡顿原因**：

1. `loadSessionsForProject` 每次都做 `project.scanSessions` RPC，即使已有缓存
2. `ensureSession` 可能再次调用 `loadSessionsForProject`
3. 所有步骤是串行的，没有利用已有缓存

### 1.3 其他项目状态盲区

- 非活跃项目/会话的状态完全未知
- 用户无法看到哪些后台会话正在运行/等待交互
- 没有 `batchGetSessionsStatus` 之类的批量状态查询接口

---

## 二、数据分类

将首次加载需要的数据按 **作用域** 和 **依赖关系** 分为 4 类：

### 2.1 全局数据（与 session 无关）

| 数据     | 存储位置           | 加载方式                 | 说明      |
| -------- | ------------------ | ------------------------ | --------- |
| 主题     | `useThemeStore`    | localStorage             | 同步，0ms |
| 显示设置 | `useSettingsStore` | localStorage             | 同步，0ms |
| Token    | localStorage       | 直接读取                 | 同步，0ms |
| RPC 连接 | `useAppStore`      | `apiClient.initialize()` | 必须完成  |

### 2.2 当前项目 + 活跃会话数据（P0，核心体验）

| 数据       | RPC                        | 依赖        | 说明             |
| ---------- | -------------------------- | ----------- | ---------------- |
| 项目打开   | `project.open`             | -           | 切换项目时需要   |
| 会话列表   | `project.scanSessions`     | -           | ⚠️ 可缓存        |
| Agent 启动 | `agent.start`              | 会话列表    | 必须先完成       |
| 会话状态   | `agent.getState`           | agent.start | 判断是否在运行   |
| 可用模型   | `agent.getAvailableModels` | agent.start | 设置界面需要     |
| 上下文用量 | `agent.getContextUsage`    | agent.start | 进度条           |
| 会话设置   | `agent.getSettings`        | agent.start | 模型、思考等级等 |
| 消息历史   | `session.getMessages`      | agent.start | 核心内容         |

### 2.3 会话配置数据（P1，非阻塞）

| 数据            | RPC                                              | 说明     |
| --------------- | ------------------------------------------------ | -------- |
| 扩展列表        | `agent.getExtensions`                            | 右侧面板 |
| 技能列表        | `agent.getSkills` + `getDisabledSkills`          | 右侧面板 |
| MCP 服务器      | `agent.getMcpServers`                            | 右侧面板 |
| 队列            | `agent.getQueue`                                 | 右侧面板 |
| 最近 Agent 变化 | `agent.getLatestAgentChange`                     | -        |
| Agent 列表      | `agent.getAgents` + `getCurrentAgent`            | 设置界面 |
| Agent 详情      | `agent.getAgentDetail` + `getAllTools`           | 设置界面 |
| Tier 配置       | `agent.getTierModels` + `session.loadTierConfig` | 设置界面 |
| 模型收藏        | `project.getModelFavorites`                      | 设置界面 |
| 记忆            | `agent.getMemory`                                | 右侧面板 |
| Git 状态        | `git.checkRepo` + `git.status`                   | Tab 显示 |
| 变更审核        | `change-review.pending`                          | 右侧面板 |

### 2.4 跨项目状态数据（P2，后台加载）

| 数据                | RPC                                     | 说明              |
| ------------------- | --------------------------------------- | ----------------- |
| 其他会话运行状态    | **新增** `agent.batchGetSessionsStatus` | 显示运行/等待状态 |
| 其他项目 Agent 信息 | `agent.getCurrentAgent`                 | 可选              |

---

## 三、设计方案

### 3.1 核心思路

```
首次加载:
  Phase 0: 全局数据 (同步, <50ms)
  Phase 1: 项目+会话恢复 (必须完成, <500ms)
  Phase 2: 活跃会话核心数据 (必须完成, <1s)
  Phase 3: 活跃会话配置数据 (后台, <2s)
  Phase 4: 跨项目状态 (后台, <3s)

切换项目:
  立即: 使用缓存的会话列表渲染 UI
  后台: 轻量刷新会话列表 + 状态差异合并
  异步: fetchInitialState 照常
```

### 3.2 会话列表缓存策略

**现状**：`loadSessionsForProject` 每次都调 `project.scanSessions` RPC。

**优化**：引入三级缓存。

```
切换项目时:
  1. sessionsByProject[path] 是否已有缓存？
     ├─ 有 → 立即用缓存渲染会话列表 + 异步做轻量刷新
     └─ 无 → 调用 loadSessionsForProject (走现有逻辑)

  2. 轻量刷新 (后台):
     ├─ project.scanSessions → 拿到最新列表
     ├─ 与缓存做 diff (新增/删除的会话)
     ├─ 只更新变化的部分
     └─ 如果列表有变化才触发 UI 更新
```

**核心原则**：

- 有缓存时，切换项目 **0ms 等待** 即可看到会话列表
- 后台刷新保证数据最终一致
- 用户无感知

### 3.3 `loadSessionsForProject` 改造

```typescript
// 新增参数
loadSessionsForProject: (
  projectPath: string,
  options?: {
    preferCache?: boolean; // 优先使用缓存，后台刷新
    forceReload?: boolean; // 强制重新加载
  },
) => Promise<SessionMeta[]>;

// 实现
loadSessionsForProject: async (projectPath, options) => {
  const { preferCache = false, forceReload = false } = options ?? {};
  const existing = get().sessionsByProject[projectPath];

  // 如果有缓存且不是强制刷新，立即返回缓存
  if (existing && existing.length > 0 && preferCache && !forceReload) {
    // 后台做轻量刷新
    get().refreshSessionsInBackground(projectPath);
    return existing;
  }

  // 无缓存或强制刷新，走完整加载流程
  set({ loading: true });
  // ... 现有的 scanSessions + merge 逻辑
};

// 新增：后台轻量刷新
refreshSessionsInBackground: async (projectPath) => {
  try {
    const result = await apiClient.call("project.scanSessions", { projectPath });
    let sessions = result.sessions as SessionMeta[];
    // ... 去重逻辑

    const cached = get().sessionsByProject[projectPath] ?? [];

    // Diff: 找新增和删除的
    const cachedIds = new Set(cached.map((s) => s.sessionId));
    const freshIds = new Set(sessions.map((s) => s.sessionId));

    const added = sessions.filter((s) => !cachedIds.has(s.sessionId));
    const removedIds = new Set(
      cached.filter((s) => !freshIds.has(s.sessionId)).map((s) => s.sessionId),
    );

    // 只在有变化时更新
    if (added.length > 0 || removedIds.size > 0) {
      const merged = cached.filter((s) => !removedIds.has(s.sessionId)).concat(added);
      set((s) => ({
        sessionsByProject: { ...s.sessionsByProject, [projectPath]: merged },
      }));
    }
  } catch {
    // 后台刷新失败不影响用户
  }
};
```

### 3.4 `setActiveProject` 改造

```typescript
setActiveProject: (id, options?) => {
  // ... 现有的清理逻辑不变

  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;

  // ... 现有的 explorer/git 逻辑不变

  if (!skipAutoSession) {
    const cached = get().sessionsByProject[tab.path];

    if (cached && cached.length > 0) {
      // ✅ 有缓存：立即选中会话，后台刷新
      const lastSid = get().lastActiveSessionByProject[tab.path];
      const target =
        lastSid && cached.some((s) => s.sessionId === lastSid) ? lastSid : cached[0].sessionId;

      set((s) => ({
        activeSessionId: target,
        lastActiveSessionByProject: { ...s.lastActiveSessionByProject, [tab.path]: target },
      }));

      // 立即切换到会话
      get().setActiveSession(target, true);

      // 后台轻量刷新会话列表
      get().refreshSessionsInBackground(tab.path);
    } else {
      // 无缓存：走完整加载（首次进入）
      get()
        .loadSessionsForProject(tab.path)
        .then((sessions) => {
          // ... 现有逻辑
        });
    }
  }
};
```

### 3.5 消除 `ensureSession` 的冗余调用

**现状**：`setActiveSession` 内的 `ensureSession` 可能再次调 `loadSessionsForProject`。

**优化**：因为 `setActiveProject` 已经保证了会话列表可用，`ensureSession` 只需要从缓存中查找。

```typescript
// setActiveSession 内部
const ensureSession = async (): Promise<SessionMeta | null> => {
  // 直接从缓存取，不再调 RPC
  const sessions = get().sessionsByProject[tab.path];
  return sessions?.find((s) => s.sessionId === id) ?? null;
};
```

### 3.6 新增 RPC：`agent.batchGetSessionsStatus`

后端新增一个批量查询方法，一次 RPC 获取多个 session 的状态。

**请求**：

```typescript
{
  sessionIds: string[];
}
```

**响应**：

```typescript
Array<{
  sessionId: string;
  status: "idle" | "streaming" | "compacting";
  // 可选扩展字段
  waitingFor?: {
    type: "ask" | "confirm" | "input" | "select";
    message: string;
  };
  currentTool?: string;
  model?: { provider: string; id: string; name: string };
}>;
```

**注意**：这个 RPC 是锦上添花，不依赖它也能工作。前端可以先用 `agent.getState` 逐个查询作为 fallback。

### 3.7 跨项目状态批量拉取

在 `useSessionStore` 新增：

```typescript
/**
 * 拉取多个 session 的运行状态（轻量）
 */
fetchSessionsStatusBatch: async (sessionIds: string[]) => {
  if (sessionIds.length === 0) return;

  try {
    // 优先使用批量接口，fallback 到逐个查询
    let results: Array<{ sessionId: string; status: SessionStatus }>;

    try {
      const raw = await apiClient.call("agent.batchGetSessionsStatus", {
        sessionIds,
      });
      results = (raw as Array<{ sessionId: string; status: string }>).map((r) => ({
        sessionId: r.sessionId,
        status: r.status as SessionStatus,
      }));
    } catch {
      // Fallback: 逐个查询，限制并发
      results = await Promise.all(
        sessionIds.map(async (sid) => {
          try {
            const state = await apiClient.call("agent.getState", { sessionId: sid });
            return {
              sessionId: sid,
              status: state.isStreaming ? "streaming" : state.isCompacting ? "compacting" : "idle",
            };
          } catch {
            return { sessionId: sid, status: "idle" as SessionStatus };
          }
        }),
      );
    }

    // 批量更新状态
    const updates: Record<string, SessionStatus> = {};
    for (const r of results) {
      updates[r.sessionId] = r.status;
    }

    set((s) => ({
      sessionStatusMap: { ...s.sessionStatusMap, ...updates },
    }));
  } catch {
    // 失败不影响用户
  }
};
```

### 3.8 首次加载分层时序

```
T0
│
├─ Phase 0 (同步, <50ms)
│   ├─ 读 localStorage: theme, settings, token
│   ├─ 有 token → 继续
│   └─ 无 token → 显示登录页
│
├─ Phase 1 (必须完成)
│   ├─ apiClient.initialize()              → RPC 连接
│   ├─ 订阅全局事件
│   ├─ project.restoreTabs()               → 恢复 tabs
│   ├─ setActiveProject(activeTabId)       → 使用缓存或加载
│   │   └─ 有缓存: 立即 setActiveSession()  ← 关键优化
│   │   └─ 无缓存: loadSessionsForProject() → setActiveSession()
│   └─ 用户看到界面框架
│
├─ Phase 2 (必须完成, 依赖 Phase 1)
│   ├─ agent.start()                       → 启动会话进程
│   ├─ agent.getState()                    → 会话状态
│   ├─ session.getMessages()               → 消息历史
│   ├─ agent.getAvailableModels()          → 模型列表
│   ├─ agent.getContextUsage()             → 上下文
│   └─ agent.getSettings()                 → 设置
│   └─ 用户可以开始操作 ✅
│
├─ Phase 3 (后台异步, 不阻塞用户)
│   ├─ agent.getExtensions()
│   ├─ agent.getSkills() + getDisabledSkills()
│   ├─ agent.getMcpServers()
│   ├─ agent.getQueue()
│   ├─ agent.getAgents() + getCurrentAgent()
│   ├─ agent.getTierModels() + session.loadTierConfig()
│   ├─ agent.getMemory()
│   ├─ git.checkRepo() + git.status()
│   └─ change-review.pending()
│
└─ Phase 4 (后台异步, 延迟 500ms)
    ├─ 当前项目其他会话状态: fetchSessionsStatusBatch()
    └─ 其他项目所有会话状态: fetchSessionsStatusBatch()
```

### 3.9 实时同步（推送）

**现有推送**：

- `agent.session_status_changed` → 更新 `sessionStatusMap`

**保持不变**：推送是实时性的保障，初始拉取 + 推送 = 100% 同步。

Phase 4 的初始拉取解决"打开页面时不知道后台状态"的问题。之后状态变化全部靠推送。

---

## 四、执行计划

### Step 1: 会话列表缓存 + 快速切换

修改文件：

- `src/mainview/stores/use-session-store.ts`

改动点：

1. `loadSessionsForProject` 新增 `preferCache` 选项
2. 新增 `refreshSessionsInBackground` 方法
3. `setActiveProject` 中有缓存时直接用缓存 + 后台刷新
4. `setActiveSession` 的 `ensureSession` 直接读缓存，不再调 RPC

### Step 2: 跨项目状态批量拉取

修改文件：

- `src/mainview/stores/use-session-store.ts`
- `src/mainview/App.tsx`（首次加载后触发）

改动点：

1. 新增 `fetchSessionsStatusBatch` 方法（带 fallback）
2. 首次加载恢复完成后，延迟 500ms 调用
3. 切换项目后，对新项目的会话触发状态拉取

### Step 3: 首次加载优化

修改文件：

- `src/mainview/App.tsx`

改动点：

1. 初始化流程中利用 Step 1 的缓存优化
2. Phase 4 跨项目状态拉取接入

### Step 4（可选）: 后端新增 `agent.batchGetSessionsStatus`

后端新增批量查询 RPC，前端优先使用，fallback 到逐个 `agent.getState`。

---

## 五、预期效果

| 场景               | 优化前   | 优化后                               |
| ------------------ | -------- | ------------------------------------ |
| 首次进入（无缓存） | ~2-3s    | ~1-2s（Phase 4 延迟到后台）          |
| 切换回已访问的项目 | ~1-2s    | **<200ms**（缓存命中，立即渲染）     |
| 切换会话（同项目） | ~1-2s    | ~1s（列表已缓存，省掉 scanSessions） |
| 查看后台会话状态   | 不可见   | 延迟 500ms 后可见                    |
| 实时性             | 仅靠推送 | 初始拉取 + 推送 = 100%               |
