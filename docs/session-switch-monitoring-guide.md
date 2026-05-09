# 会话切换性能监控手册

## 日志文件位置

| 环境         | 路径                                      |
| ------------ | ----------------------------------------- |
| 服务端日志   | `logs/YYYY-MM-DD.log` (项目根目录下)      |
| 浏览器控制台 | DevTools → Console，筛选 `[SESSION-PERF]` |

所有性能日志都使用 `session-perf` 模块名，可通过 grep 快速过滤：

```bash
grep "session-perf" logs/2026-05-09.log
# 或浏览器控制台输入: 过滤 "session-perf"
```

---

## 日志标签速查表

| 标签                 | 含义               | 所在文件                   |
| -------------------- | ------------------ | -------------------------- |
| `[switch]`           | 整体会话切换流程   | `use-session-store.ts`     |
| `[setupSubs]`        | WebSocket 订阅注册 | `session-subscriptions.ts` |
| `[start]`            | RPC 子进程启动     | `process-manager.ts`       |
| `[createRpcClient]`  | RPC Client 构造    | `process-manager.ts`       |
| `[replayHoldEvents]` | 缓存事件重放       | `process-manager.ts`       |
| `[getFullMessages]`  | 消息全量加载       | `process-manager.ts`       |
| `[loadMessages]`     | 前端消息解析+渲染  | `use-chat-store.ts`        |
| `[fetchInit]`        | 初始状态数据拉取   | `use-session-store.ts`     |

---

## 完整会话切换流水线

```
用户点击切换会话
│
├─ [switch] === SESSION SWITCH START ===          ← 总计时起点
│   ├─ step-1: cleanup old session                ← 退订 ~16 个 WebSocket 订阅 + 清空 store
│   │   └─ 日志: [switch] step-1 cleanup old session {prevId, ms}
│   │
│   ├─ step-2: setupSubscriptions                 ← 注册 ~16 个新 WebSocket 订阅
│   │   └─ 日志: [setupSubs] begin / ...dispatched {sessionId, dispatchMs}
│   │
│   ├─ step-3: agent.start RPC                    ← 核心瓶颈：可能 spawn 子进程
│   │   │   └─ 日志: [switch] step-3 agent.start RPC begin/done {sessionId, status, ms}
│   │   │
│   │   └─ 服务端内部流程:
│   │       ├─ [start] begin (new process)        ← 或 already_running (缓存命中)
│   │       ├─ [createRpcClient] done             ← {dynamicImportMs, constructMs}
│   │       ├─ 注册 7 个 channel 监听
│   │       ├─ client.start()                     ← 子进程启动
│   │       └─ [start] completed                  ← {totalMs, dynamicImportMs, constructMs, processStartMs}
│   │
│   ├─ step-4: fetchInitialState (异步，不阻塞)    ← 5+ 个 RPC 并行
│   │   ├─ step-a: getState + getAvailableModels  ← 并行
│   │   ├─ step-b: getContextUsage                ← 有重试 (最多3次, 1.5s间隔)
│   │   ├─ step-c: getExtensions
│   │   ├─ step-d: getSkills + getDisabledSkills  ← 并行
│   │   └─ step-e: getQueue
│   │
│   ├─ step-5: replayHoldEvents (仅 already_running)
│   │   └─ 日志: [switch] step-5 replayHoldEvents done {replayed, ms}
│   │
│   └─ step-6: loadSessionMessages                ← 前端消息加载
│       ├─ [getFullMessages] done                 ← 服务端: {messageCount, totalMs}
│       ├─ [loadMessages] RPC returned            ← 前端: {rpcMs}
│       ├─ 消息解析 + normalizeToolBlocks
│       └─ [loadMessages] done                    ← 前端: {total, totalMs}
│
└─ [switch] === SESSION SWITCH COMPLETE ===       ← 总计时终点
    └─ 日志: {sessionId, totalMs}
```

---

## 常用排查命令

### 1. 查看某次切换的总耗时

```bash
grep "SESSION SWITCH" logs/2026-05-09.log
```

输出示例：

```
[switch] === SESSION SWITCH START === {"from":"sess_abc","to":"sess_xyz","force":false}
[switch] === SESSION SWITCH COMPLETE === {"sessionId":"sess_xyz","totalMs":3542}
```

### 2. 定位最慢的步骤

```bash
grep "\[switch\] step-" logs/2026-05-09.log | tail -20
```

输出示例：

```
[switch] step-1 cleanup old session {"prevId":"sess_abc","ms":12}
[switch] step-2 setupSubscriptions dispatched {"sessionId":"sess_xyz","ms":5}
[switch] step-3 agent.start RPC begin {"sessionId":"sess_xyz"}
[switch] step-3 agent.start RPC done {"sessionId":"sess_xyz","status":"started","ms":2850}
[switch] step-5 replayHoldEvents done {"sessionId":"sess_xyz","replayed":0,"ms":45}
[switch] step-6 loadSessionMessages done {"sessionId":"sess_xyz","count":128,"ms":420}
```

### 3. 检查 agent.start 的内部耗时分解

```bash
grep "\[start\]" logs/2026-05-09.log
```

输出示例：

```
[start] begin (new process) {"sessionId":"sess_xyz","projectPath":"/path/to/project"}
[createRpcClient] done {"dynamicImportMs":85,"constructMs":12}
[start] completed {"sessionId":"sess_xyz","totalMs":2850,"dynamicImportMs":85,"constructMs":12,"createRpcTotalMs":120,"processStartMs":2730}
```

关键指标：

- `dynamicImportMs`: 动态 import `pi-coding-agent` 模块的耗时（首次会慢，后续有缓存）
- `constructMs`: `new RpcClient()` 构造耗时
- `processStartMs`: `client.start()` 子进程启动+扩展加载耗时 ← 通常最耗时

### 4. 检查 already_running（缓存命中）场景

```bash
grep "already_running" logs/2026-05-09.log
```

如果出现 `[start] already_running (cached hit) {"totalMs":2}`，说明进程已在内存中，无需重新启动。

### 5. 检查 fetchInitialState 各子调用耗时

```bash
grep "\[fetchInit\]" logs/2026-05-09.log
```

输出示例：

```
[fetchInit] begin {"sessionId":"sess_xyz"}
[fetchInit] step-a getState+getAvailableModels {"sessionId":"sess_xyz","ms":120}
[fetchInit] step-b getContextUsage {"sessionId":"sess_xyz","attempt":0,"ms":85}
[fetchInit] step-c getExtensions {"sessionId":"sess_xyz","ms":95}
[fetchInit] step-d getSkills+getDisabledSkills {"sessionId":"sess_xyz","ms":110}
[fetchInit] step-e getQueue {"sessionId":"sess_xyz","ms":45}
[fetchInit] ALL sub-calls dispatched {"sessionId":"sess_xyz","totalMs":120}
```

注意：step-b ~ step-e 是并行的，`totalMs` 约等于最慢那个子调用的耗时。

### 6. 检查消息加载耗时

```bash
grep -E "\[getFullMessages\]|\[loadMessages\]" logs/2026-05-09.log
```

- `[getFullMessages] done` — 服务端读取+返回消息的耗时
- `[loadMessages] RPC returned` — 网络传输耗时
- `[loadMessages] done` — 前端解析+渲染耗时

### 7. 只看所有计时数据

```bash
grep "session-perf" logs/2026-05-09.log | grep -oP '"ms":\d+|"totalMs":\d+|"\w+Ms":\d+'
```

---

## 性能基线参考

以下为正常情况下的预期耗时范围：

| 步骤                | 首次切换 (新进程)             | 切回 (already_running) |
| ------------------- | ----------------------------- | ---------------------- |
| step-1 cleanup      | 5-30ms                        | 5-30ms                 |
| step-2 setupSubs    | 3-15ms                        | 3-15ms                 |
| step-3 agent.start  | 2-10s                         | **<5ms** (缓存命中)    |
| ├─ dynamicImport    | 50-200ms (首次) / <5ms (缓存) | N/A                    |
| ├─ construct        | 5-20ms                        | N/A                    |
| └─ processStart     | 1.5-8s                        | N/A                    |
| step-4 fetchInit    | 100-500ms                     | 100-500ms              |
| step-5 replayHold   | 0-200ms                       | 0-200ms                |
| step-6 loadMessages | 100-500ms                     | 100-500ms              |
| **总耗时**          | **3-12s**                     | **300ms-1.5s**         |

---

## 常见问题排查

### Q1: 切换会话很慢（>10s）

1. 先查总耗时：`grep "SESSION SWITCH COMPLETE" logs/DATE.log`
2. 定位瓶颈步骤：`grep "\[switch\] step-" logs/DATE.log`
3. 如果 step-3 耗时长：
   - 检查 `processStartMs` — 子进程启动慢 → 检查扩展数量和加载速度
   - 检查 `dynamicImportMs` — 模块加载慢 → 检查 `node_modules` 是否完整
4. 如果 step-6 耗时长：消息量大 → 考虑分页或懒加载

### Q2: 切回已访问会话仍然慢

1. 检查是否真的命中缓存：`grep "already_running" logs/DATE.log`
2. 如果没有 `already_running`，说明进程已被 stop 或 GC
3. 如果命中了但仍然慢，检查 step-5 (replayHoldEvents) 和 step-6 (loadMessages)

### Q3: fetchInitialState 超时或失败

1. 查看重试日志：`grep "getContextUsage" logs/DATE.log`
2. 检查 `attempt` 字段 — 如果看到 attempt=2，说明连续失败 3 次
3. 通常是子进程还没完全初始化就被调用，属于时序问题

### Q4: 浏览器端没有看到 session-perf 日志

- 服务端日志写入文件，浏览器控制台只显示 console 输出
- 确认 `setLogSink` 已被调用（在 `server.ts` 和 `bun/index.ts` 中配置）
- 浏览器控制台筛选 `session-perf` 模块名即可
