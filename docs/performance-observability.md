# 聊天与 Fork 性能观测、快速排查与监控方案

> 适用范围：`pi-agent-chat` renderer / Zustand store / Gateway / RPC，以及关联的 `pi-momo-fork/packages/coding-agent` runtime。
>
> 目标：先定位瓶颈所在层，再决定优化方向。不要只凭“页面卡”直接修改消息组件。

## 1. 观测原则

1. **先分层**：浏览器渲染、Gateway/RPC、Agent runtime、JSONL/Fork 文件 I/O 分开测量。
2. **先测 RPC/runtime，再测 UI**：先确认消息加载、Fork、context materialization 的耗时，再用浏览器 Performance/React Profiler 判断渲染成本。
3. **所有关键操作带关联信息**：至少记录 `traceId`、`sessionId`、操作名、耗时、结果状态和数据规模；不要记录完整 prompt、消息正文、token、auth 或未经脱敏的绝对路径。
4. **记录 p50/p95，不只看平均值**：性能问题通常发生在长会话、重型工具输出或大量 Fork 的尾部请求。
5. **可恢复状态不能只依赖事件**：刷新、重连或重启后，UI 应从 runtime snapshot 重建，再继续接收 live events。性能优化不能破坏这一点。

## 2. 统一指标模型

建议所有层使用下面的字段命名，便于串联一条请求：

```text
traceId
sessionId
operation
startedAt / durationMs
status: ok | error | timeout | cancelled
messageCount / entryCount / branchDepth
payloadBytes / sessionFileBytes
cacheHit: true | false
```

### 2.1 前端聊天指标

| 指标                            | 含义                                   | 重点判断               |
| ------------------------------- | -------------------------------------- | ---------------------- |
| `chat.session_restore_ms`       | 切换/恢复会话到首个可见消息            | RPC 慢还是 renderer 慢 |
| `chat.first_visible_message_ms` | 页面开始恢复到首条消息显示             | 首屏体验               |
| `chat.message_update_rate`      | 每秒收到的流式更新数                   | 是否需要更激进的合并   |
| `chat.batcher_flush_rate`       | batch flush 次数和每批事件数           | 批处理是否有效         |
| `chat.message_projection_ms`    | 消息映射、归一化、SideNav 数据生成耗时 | 是否存在全窗口重复计算 |
| `chat.markdown_parse_ms`        | Markdown/代码/Mermaid 解析耗时         | 重型卡片是否阻塞主线程 |
| `chat.virtual_mounted_count`    | 当前实际挂载的消息卡片数               | 虚拟列表是否失效       |
| `chat.loaded_message_count`     | store 当前加载消息数                   | 分页和窗口是否生效     |
| `chat.long_task_ms`             | 主线程超过 50ms 的任务                 | 滚动、流式输出卡顿定位 |

### 2.2 Gateway/RPC 指标

重点记录以下方法：

```text
agent.getFullMessages
agent.getContextUsage
agent.fork
agent.start
agent.stop
session.getEntries
session.getTree
```

每次 RPC 至少记录：

- `durationMs`
- `payloadBytes` 和响应消息数量
- `limit`、`beforeEntryId`、`afterEntryId` 是否使用
- timeout / error 类型
- 当前是否处于 streaming 或 reconnect recovery

如果 `limit=50` 的请求仍然处理了完整的几千条 entry，应优先检查 runtime 的读模型，而不是继续优化 React。

### 2.3 Fork runtime 指标

在 `pi-momo-fork` 中建议观测：

| 指标                                  | 含义                                        |
| ------------------------------------- | ------------------------------------------- |
| `runtime.branch_build_ms`             | 从 leaf 构建当前 branch 的耗时              |
| `runtime.context_materialize_ms`      | `buildSessionContext()` 耗时                |
| `runtime.context_cache_hit`           | canonical materialized context 是否命中缓存 |
| `runtime.full_messages_ms`            | `get_full_messages` 总耗时                  |
| `runtime.full_messages_projection_ms` | deletion/summary/message projection 耗时    |
| `runtime.tree_projection_ms`          | tree metadata 构造耗时                      |
| `runtime.jsonl_read_ms`               | JSONL 读取和解析耗时                        |
| `runtime.jsonl_read_bytes`            | 实际读取字节数                              |
| `runtime.fork_copy_ms`                | Fork 文件创建耗时                           |
| `runtime.fork_copy_bytes`             | Fork 实际复制字节数                         |
| `runtime.process_rss_mb`              | Agent 进程内存                              |

建议给 `SessionManager` 增加 revision 计数，在 append、leaf pointer、delete、compaction、branch 操作后递增。缓存键至少包括：

```text
sessionRevision + leafId + materializationOptions
```

缓存只用于 canonical raw branch/materialized context；不要缓存经过前端推测或 hook 修改后的最终 UI 状态。

## 3. 推荐的埋点位置

### 3.1 前端

已有 `perfLog` 和 `createLogger` 时优先复用，不要直接新增 `console.log`。建议在以下位置增加统一的开始/结束埋点：

- `use-chat-store.ts`：`loadSessionMessages`、`loadMoreMessages`、`loadFocusedMessagesAround`
- `agent-event-handler.ts`：消息批处理 flush、`message_end`、reconnect replay
- `MessageListView.tsx`：消息 projection、card metadata、虚拟列表挂载数量
- `CachedReactMarkdown.tsx`：解析耗时、缓存命中率、文本长度分桶
- `ForkDialog.tsx`：Fork 点击到新 session 可交互的完整耗时

消息正文不要写入日志。可记录长度、block 数量、tool 数量和 hash 前缀。

### 3.2 Gateway / RPC

在 RPC 入口和响应出口包一层轻量计时器，统一生成 `traceId`。对大响应记录字节数和数量，不记录 payload 内容。

建议响应中保留可选的诊断字段，仅在开发模式或显式 debug 开关开启时返回：

```ts
{
  diagnostics: {
    traceId,
    durationMs,
    entryCount,
    messageCount,
    cacheHit,
  }
}
```

生产环境可以只写结构化日志，避免把诊断字段暴露给普通客户端。

### 3.3 Fork runtime

重点在 `SessionManager.getBranch()`、`buildSessionContext()`、`copyBranchedSession()` 和 RPC `get_full_messages` 周围埋点。

应把一个 `get_full_messages` 拆成几个阶段测量：

```text
load/index lookup
branch traversal
deletion/segment materialization
message projection
tree/custom/compaction projection
serialization/RPC write
```

这样可以区分“branch 遍历慢”和“虽然分页但仍然构造完整响应慢”。

## 4. 快速性能排查流程

### A. 页面打开或切换会话很慢

1. 先看 `loadSessionMessages` 的 `rpcMs`、返回消息数和 `totalCount`。
2. 若 RPC 慢，直接调用 `agent.getFullMessages`，检查 `limit=50` 是否仍扫描完整 session。
3. 若 RPC 快但页面慢，用 Chrome Performance 看首个 long task；再用 React Profiler 看 `ChatPanel`、`MessageListView` 和 `MessageCard` 的 commit。
4. 检查 `loaded_message_count`、虚拟列表 mounted 数量和 `message_projection_ms`。
5. 若消息数量只有几十条但 projection 很慢，优先检查 Markdown、Diff、Mermaid 或 tool card。

常用本地检查：

```bash
# 找 session / RPC 性能日志
rg -n "loadMessages|loadMoreMessages|getFullMessages|session-perf|traceId" logs src

# 查看单个 session 文件规模
du -h <session-path>
wc -l <session-path>
```

### B. 流式输出卡顿或输入延迟

1. 记录 10 秒内的 `message_update_rate`、batch flush 次数和每批事件数。
2. 若事件很多但 flush 很少，检查 UI 是否仍被每个事件触发。
3. 若 React commit 很多，检查是否每次都复制完整消息数组，或是否扫描完整消息窗口。
4. 若 React commit 不多但仍卡，检查 Markdown、代码高亮、Mermaid 和大 tool output 的主线程长任务。
5. 检查 tool event 是否按 `toolCallId` 保序；不能为了性能按 `sessionId` 粗暴丢弃并行工具事件。

### C. Fork 创建很慢或占用内存高

1. 先测 `agent.fork` 的 runtime 耗时，不要先看 ForkDialog。
2. 记录源 session 文件大小、branch depth、复制字节数和 `prepareForkedSession` 耗时。
3. 如果 coordinator fork 使用整体 `readFileSync + split`，优先改成流式转换和临时文件 atomic rename。
4. 如果文件复制很快但新会话可用很慢，再测 `agent.start`、session restore 和首次 `getFullMessages`。
5. 用进程 RSS 对比 Fork 前后，判断问题是文件 I/O 还是每个 Fork 启动独立 Agent 造成的内存增长。

```bash
# 查看 Pi / Bun 进程的 RSS 和运行时间
ps -axo pid,rss,etime,command | rg "pi|bun|PiAgentChat"

# 查看当前监听端口和进程归属
lsof -nP -iTCP:3100 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

### D. 重连后页面状态不完整

这类问题先判定为恢复链路问题，不要直接给组件加更多本地状态：

1. 比较 runtime recovery snapshot 与 reconnect 前的状态。
2. 检查 snapshot 是否包含 active session、streaming message、tool card 和 pending request。
3. 再检查 live event 是否重复、丢失或乱序。
4. 最后才检查 React store 是否正确合并 snapshot 和事件。

## 5. 基准测试矩阵

至少准备以下 session：

| 场景         | 数据规模                        |
| ------------ | ------------------------------- |
| 普通短会话   | 50 messages / 100 entries       |
| 长聊天       | 3,000 messages / 6,000+ entries |
| 深分支       | branch depth 1,000              |
| 宽分支       | 1 个 root 下 50 个 Fork         |
| 重型工具输出 | 单个 tool output 1MB+           |
| 高频流式     | 30-60 updates/sec               |
| 多 Fork 进程 | 10-20 个 idle Fork              |

每次优化至少记录：

- p50 / p95 / max
- 浏览器主线程 long task
- 页面 heap 和 Agent RSS
- JSONL 读取字节数
- RPC payload 字节数
- 是否影响 refresh/reconnect、分页、SideNav 和并行 tool event

## 6. 分阶段监控方案

### Phase 1：本地可见

- 统一 `perfLog` 字段和 `traceId`
- 开发环境输出结构化性能日志
- 增加浏览器 Performance/React Profiler 的人工验收步骤
- 为 `get_full_messages`、Fork、session restore 建立固定基准

### Phase 2：可聚合

- 将前端、Gateway、runtime 日志统一为 JSONL
- 按 `operation + status + size bucket` 聚合 p50/p95
- 只保留长度、数量、耗时、hash 前缀等低敏字段
- 增加慢请求阈值，例如 `getFullMessages > 500ms`、Fork > 1s、主线程 long task > 100ms

### Phase 3：长期监控

如果以后接入 OpenTelemetry、Prometheus 或其他监控系统，建议沿用同一组 operation 名称和字段，不要重新设计一套指标。首批只监控：

```text
chat.session_restore_ms
chat.stream_frame_drop_rate
rpc.get_full_messages_ms
runtime.context_materialize_ms
runtime.fork_copy_ms
runtime.process_rss_mb
```

## 7. 性能优化验收门槛

任何聊天或 Fork 性能优化都至少需要：

- 一个优化前后的基准数据对比
- 一个长会话场景
- 一个重型 tool output 场景
- 一个 refresh/reconnect 场景
- 一个并行 tool event 场景
- 一份未测风险说明

性能优化不能通过隐藏移动端 SideNav、减少恢复数据或复用错误的 RPC client 来换取指标变好。正确的优化应该减少重复计算、减少无效传输、延迟重型渲染或改善缓存命中率，同时保留 session ownership 和 recovery contract。
