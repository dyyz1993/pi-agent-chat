# RpcClient 集成方案

**日期:** 2026-04-26
**状态:** 已实施 + 已验证

---

## 1. 背景

### 1.1 问题

项目 `pi-agent-chat` 通过 spawn 子进程与 `pi-coding-agent` 通信，原实现手写了完整的 JSONL 协议层（`StreamParser` + `pendingRequests` Map + 超时管理），存在以下问题：

- 手写协议层 ~200 行，类型不安全（全量 `as Record<string, unknown>`）
- 硬编码 6 个绝对路径
- `holdEvents` 缓存机制未精确处理 `message_end` 时序，导致重连时与 `getMessages()` 数据重复
- 缺少 `steer`、`followUp`、`setModel` 等 20+ 个 RpcClient API

### 1.2 目标

1. 用 `RpcClient` SDK 替换手写 JSONL 协议层
2. 用 `getMessages()` 替换 `session.getEntries` 文件读取
3. 修正 `holdEvents` 缓存时序，消除重连数据重复
4. 一次性补全所有 RpcClient API

---

## 2. 架构

### 2.1 通信架构

```
[Browser UI]  ←WebSocket/IPC→  [Bun Server]  ←RpcClient SDK→  [pi-coding-agent child process]
                                  │
                                  ├─ AgentProcessManager
                                  │   └─ Map<sessionId, ManagedClient>
                                  │       ├─ client: RpcClient
                                  │       ├─ info: AgentProcessInfo (status, holdEvents)
                                  │       └─ unsubscribe: () => void
                                  │
                                  ├─ rpc-core RPCServer (UI ↔ Server)
                                  └─ HTTP routes (/file, /health)
```

### 2.2 关键变更

| 组件 | 变更前 | 变更后 |
|------|--------|--------|
| 进程管理 | `spawn` + `StreamParser` + `pendingRequests` | `new RpcClient()` + `client.onEvent()` |
| 历史消息 | `session.getEntries` 读 JSONL 文件 | `client.getMessages()` 从 agent 获取 |
| 事件路由 | `stdout.on("data")` 手动解析分发 | `client.onEvent(cb)` 统一订阅 |
| 配置路径 | 硬编码 6 个绝对路径 | `server-config.ts` + 环境变量 |
| API 覆盖 | 8 个方法 | 30+ 个方法（全量） |

---

## 3. holdEvents 重连机制

### 3.1 核心问题

`getMessages()` 只返回已持久化的消息（`message_end` 后）。流式中的内容存在 agent 的 `_state.streamingMessage` 中，不会出现在 `getMessages()` 返回值里。因此需要 holdEvents 缓存实时事件，供重连时重放。

### 3.2 缓存策略

```
agent_start     → holdEvents = [] 开始缓存
message_start   → hold
message_update  → hold（累积文本快照）
message_end     → holdEvents = [] ← 清空！消息已持久化，getMessages 可拿到
tool_execution  → hold（新的，重新开始缓存）
message_start   → hold
message_update  → hold
message_end     → holdEvents = [] ← 再次清空
agent_end       → holdEvents = []
```

**关键**：`message_end` 时清空，防止与 `getMessages()` 产生重复。

### 3.3 重连时序

```
客户端刷新/重连：

1. subscribe              → 建立实时事件通道（不丢新事件）
2. agent.start            → 确认进程存在，返回 already_running（不触发重放）
3. getMessages            → 加载已持久化历史到前端 store
4. replayHoldEvents       → 重放 hold 的实时事件（tool 事件可挂载到已有消息上）
5. 实时事件持续流入        → 无缝衔接
```

**时序保证**：
- 步骤 1 先于步骤 4，所以重放和实时事件不会重叠
- 步骤 3 先于步骤 4，所以 tool 事件有 assistant 消息可挂载
- 步骤 2 不触发重放，避免在 store 为空时重放

### 3.4 边缘场景分析

| 场景 | holdEvents 内容 | getMessages | 结果 |
|------|----------------|-------------|------|
| 流式中重连（message_end 前） | message_start + message_update ×N | 空 | 重放恢复完整流式内容 ✓ |
| message_end 后 tool 执行中重连 | tool_execution ×N | 有历史 | getMessages 加载历史，replay 挂载 tool ✓ |
| agent_end 后重连 | 空 | 完整历史 | 直接加载，无需重放 ✓ |
| message_end 和重连同时 | 可能包含 message_end + 后续事件 | 有历史 | 前端兜底处理（message_end 无 streaming 消息则忽略）✓ |

---

## 4. 变更文件清单

### 4.1 重写

| 文件 | 说明 |
|------|------|
| `src/shared/agent/process-manager.ts` | 完全重写：RpcClient 替代手写协议 |
| `src/shared/handlers/agent.ts` | 注册 30+ RPC 方法 |
| `src/shared/modules/agent.ts` | 补全所有方法类型定义 + AgentProcessInfo |

### 4.2 修改

| 文件 | 说明 |
|------|------|
| `src/server-config.ts` | 新增 `piCliPath` 和 `piExtensionPaths` |
| `src/mainview/stores/use-session-store.ts` | 重连时序：getMessages → replayHoldEvents；message_update 兜底创建 streaming 消息 |
| `src/mainview/stores/use-chat-store.ts` | `loadSessionMessages` 改为调用 `agent.getMessages` |

### 4.3 删除

| 文件 | 说明 |
|------|------|
| `src/shared/agent/stream-parser.ts` | RpcClient 内置 JSONL 解析 |
| `src/shared/agent/jsonl-helpers.ts` | RpcClient 内置序列化 |

---

## 5. 新增 API 清单

以下 API 通过 `agent.*` RPC 方法暴露给前端：

| 类别 | 方法 |
|------|------|
| 对话 | `agent.send`, `agent.steer`, `agent.followUp`, `agent.abort` |
| 模型 | `agent.setModel`, `agent.cycleModel`, `agent.getAvailableModels` |
| 思考 | `agent.setThinkingLevel`, `agent.cycleThinkingLevel` |
| 压缩/重试 | `agent.compact`, `agent.setAutoCompaction`, `agent.setAutoRetry`, `agent.abortRetry` |
| 排队 | `agent.setSteeringMode`, `agent.setFollowUpMode`, `agent.getQueue`, `agent.clearQueue` |
| 工具 | `agent.getActiveTools`, `agent.setActiveTools`, `agent.getTools`, `agent.getSkills`, `agent.getExtensions` |
| 设置 | `agent.getSettings`, `agent.setSettings`, `agent.getContextUsage` |
| 会话 | `agent.getMessages`, `agent.setSessionName`, `agent.getLastAssistantText`, `agent.getForkMessages`, `agent.fork`, `agent.clone`, `agent.newSession`, `agent.exportHtml` |
| 重连 | `agent.replayHoldEvents` |

---

## 6. 测试验证结果

### 6.1 功能测试（12 项全通过）

```
✓ agent.start (RpcClient spawn)
✓ agent.getState
✓ agent.getAvailableModels
✓ agent.getMessages (空会话)
✓ agent.getCommands
✓ agent.send (prompt)
✓ 等待 agent_end 事件
✓ agent.getMessages (对话后) → 2 messages
✓ agent.getSessionStats
✓ agent.stop
```

### 6.2 重连测试

**流式中断重连**：
```
连接1 断开时 textLen=596
重连后首条 message_update textLen=796 (>= 596 ✓)
事件覆盖了断开前内容 ✓
```

**holdEvents 即时恢复**：
```
连接1 断开时 textLen=515
重放事件数: 21, 重放后 textLen=872 (>= 515 ✓)
重放耗时: 104ms ✓
```

### 6.3 重复检测

**修复前**：holdEvents 到 agent_end 才清空 → 重放 39 条 + getMessages 11 字符 → ⚠️ 重复
**修复后**：message_end 时清空 → 重放 6 条（仅 tool）+ getMessages 11 字符 → ✓ 无重复

### 6.4 边缘场景

**message_end 后 tool 执行中重连**：
```
时序: getMessages(2条) → replayHoldEvents(5条: tool_events)
结果: tool_execution 成功挂载到已有 assistant 消息 ✓
无重复 ✓
```
