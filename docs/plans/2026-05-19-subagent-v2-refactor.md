# Subagent-v2 架构重构 + Bug 修复

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构 subagent-v2 从"extension 自己 spawn 子进程"改为"通过 coordinator channel 让 Process Manager 创建子会话"，同时修复已知 bug、完善权限流程、增加 steer 模式。

**Architecture:** subagent-v2 不再自己管理 RpcClient 生命周期，改为调用 coordinator channel 的 `session_delegate` 方法让 Process Manager 创建子会话。保留同步阻塞语义（tool call 等 agent_end），砍掉 background 模式（统一走 coordinator）。权限请求自然走 Process Manager 主通道，不再需要二级桥接。

**Tech Stack:** TypeScript, Zustand, RPC/Channel, Process Manager

---

## Phase 1: Bug 修复（Quick Wins）

> 先修 bug，不改架构，确保当前功能稳定。

### Task 1: 修复 `subToolCallNameMap` 内存泄漏

**Files:**

- Modify: `src/mainview/stores/use-subagent-store.ts:20` (subToolCallNameMap)
- Modify: `src/mainview/stores/use-subagent-store.ts:192-217` (deleteSubagent)
- Modify: `src/mainview/stores/session-subscriptions.ts:595-604` (cleanupSessionData)

**Step 1: 导出清理函数**

在 `use-subagent-store.ts` 的 `handleSubagentEvent` 函数后，新增导出：

```typescript
// use-subagent-store.ts — 在文件末尾 handleSubagentEvent 函数之后
export function cleanupSubagentToolCallNames(subId: string): void {
  const keysToDelete: string[] = [];
  for (const [key, value] of Object.entries(subToolCallNameMap)) {
    // subToolCallNameMap 的 value 是 toolCallName，key 是 toolCallId
    // 但我们需要按 subId 清理，所以需要在存储时也记录 subId
    // 更简单的方案：改为 Map<subId, Record<toolCallId, toolName>>
  }
}
```

实际上，`subToolCallNameMap` 是 `Record<toolCallId, toolName>`，但 `toolCallId` 和 `subId` 之间没有映射。需要改为二级结构。

**修改方案：**

```typescript
// use-subagent-store.ts:20 — 替换模块级变量
// 旧: const subToolCallNameMap: Record<string, string> = {};
// 新: 按子会话 ID 分组
const subToolCallNameMapBySubId: Record<string, Record<string, string>> = {};
```

**Step 2: 更新 handleSubagentEvent 中所有 `subToolCallNameMap` 引用**

搜索 `subToolCallNameMap` 的所有使用位置（约 3-4 处），改为：

```typescript
// 旧: subToolCallNameMap[toolCallId] = toolName;
// 新:
if (!subToolCallNameMapBySubId[subId]) subToolCallNameMapBySubId[subId] = {};
subToolCallNameMapBySubId[subId][toolCallId] = toolName;
```

```typescript
// 旧: delete subToolCallNameMap[block.toolCallId];
// 新:
const map = subToolCallNameMapBySubId[subId];
if (map) delete map[block.toolCallId];
```

```typescript
// 旧: const toolName = subToolCallNameMap[block.toolCallId] ?? block.toolName;
// 新:
const toolName = subToolCallNameMapBySubId[subId]?.[block.toolCallId] ?? block.toolName;
```

**Step 3: 在 deleteSubagent 中清理**

```typescript
// use-subagent-store.ts: deleteSubagent 函数内，set 回调之后
delete subToolCallNameMapBySubId[subSessionId];
```

**Step 4: 在 cleanupSessionData 中清理该 session 的所有 subagent**

```typescript
// session-subscriptions.ts: cleanupSessionData 函数末尾添加
const { subsessionsByParent, messagesBySubsession } = useSubagentStore.getState();
// 找到该 session 对应的 subagent，清理它们的 toolCallNameMap
for (const subId of Object.keys(messagesBySubsession)) {
  // 检查这个 subId 是否属于被清理的 session
  // 通过 subsessionsByParent 查找
  for (const subs of Object.values(subsessionsByParent)) {
    if (subs.some((s) => s.sessionId === subId)) {
      delete subToolCallNameMapBySubId[subId]; // 需要导出这个函数
    }
  }
}
```

更简洁的方案：导出一个 `clearSubagentData(sessionId)` 函数：

```typescript
// use-subagent-store.ts — 新增导出函数
export function clearSubagentToolNames(subIds: string[]): void {
  for (const id of subIds) {
    delete subToolCallNameMapBySubId[id];
  }
}
```

**Step 5: 添加单元测试**

```typescript
// test/subagent-toolcall-cleanup.test.ts
import { describe, it, expect, beforeEach } from "bun:test";

describe("subToolCallNameMap cleanup", () => {
  it("should clean up map when subagent is deleted", () => {
    // 模拟添加 subagent tool call
    // 调用 deleteSubagent
    // 验证 map 已清理
  });

  it("should not affect other subagents when one is deleted", () => {
    // 添加两个 subagent 的 tool calls
    // 删除其中一个
    // 验证另一个的 map 还在
  });
});
```

**Step 6: 运行测试**

```bash
bun test test/subagent-toolcall-cleanup.test.ts
```

**Step 7: Commit**

```bash
git add src/mainview/stores/use-subagent-store.ts src/mainview/stores/session-subscriptions.ts test/subagent-toolcall-cleanup.test.ts
git commit -m "fix: prevent subToolCallNameMap memory leak on subagent deletion"
```

---

### Task 2: 修复 `runWithTimeout` 吞掉错误

**Files:**

- Modify: `pi-momo-fork/packages/coding-agent/extensions/subagent-v2/index.ts:116-150`

**Step 1: 修改 runWithTimeout，区分"已解决"和"错误"**

```typescript
// 旧 (line 134-136):
// completionPromise
//   .then(() => "done" as const)
//   .catch(() => "done" as const),

// 新:
let completionError: unknown;
const completionResult = completionPromise
  .then(() => "done" as const)
  .catch((err) => {
    completionError = err;
    return "error" as const;
  });
```

**Step 2: 更新 Promise.race**

```typescript
return Promise.race([completionResult, timeoutPromise, signalAbortPromise]);
```

**Step 3: 在 foreground path 处理 "error" 结果**

```typescript
// index.ts line 429 附近
if (raceResult === "error") {
  currentResult.exitCode = 1;
  currentResult.errorMessage =
    completionError instanceof Error ? completionError.message : String(completionError);
  currentResult.stopReason = "error";
}
```

**Step 4: Commit**

```bash
git commit -m "fix: propagate subagent execution errors instead of swallowing them"
```

---

### Task 3: 给 `ctx.ui.confirm()` 加超时保护

**Files:**

- Modify: `pi-momo-fork/packages/coding-agent/extensions/subagent-v2/index.ts:234`

**Step 1: 添加超时参数**

```typescript
// 旧 (line 234):
// const ok = await ctx.ui.confirm("Run project-local agent?", `Agent: ${agent.name}...`);

// 新:
const ok = await ctx.ui.confirm("Run project-local agent?", `Agent: ${agent.name}...`, {
  timeout: 30000,
});
```

检查 `ctx.ui.confirm` 的签名是否支持 options 参数。根据 rpc-mode.ts line 157-159，签名是 `confirm(title, message, opts?)`，opts 类型 `ExtensionUIDialogOptions` 有 `timeout` 字段。

**Step 2: Commit**

```bash
git commit -m "fix: add 30s timeout to project-agent permission dialog"
```

---

## Phase 2: 给 Coordinator 增加 Steer 模式

> 让 delegate_send 支持打断式消息投递。

### Task 4: 扩展 Coordinator 类型定义

**Files:**

- Modify: `pi-momo-fork/packages/coding-agent/extensions/coordinator/types.ts:46-49`
- Modify: `src/shared/modules/coordinator.ts:47-49`
- Modify: `src/shared/modules/coordinator.ts:72-76` (CoordinatorMethodCall)

**Step 1: 后端 contract — 添加 mode 参数**

```typescript
// coordinator/types.ts — 修改 session_delegate_send
session_delegate_send: {
  params: { targetSessionId: string; message: string; mode?: "followUp" | "steer" };
  return: DelegateSendResult;
};
```

**Step 2: 前端 types — 同步更新**

```typescript
// coordinator.ts — CoordinatorMethods
"coordinator.delegate_send": {
  params: { targetSessionId: string; message: string; mode?: "followUp" | "steer" };
  result: DelegateSendResult;
};
```

```typescript
// coordinator.ts — CoordinatorMethodCall
{
  __call: "session_delegate_send";
  targetSessionId: string;
  message: string;
  mode?: "followUp" | "steer";  // 新增
  invokeId?: string;
}
```

**Step 3: Commit**

```bash
git commit -m "feat: add mode parameter to session_delegate_send contract"
```

---

### Task 5: Process Manager 实现 steer 模式

**Files:**

- Modify: `src/shared/agent/process-manager.ts:2481-2545`

**Step 1: 修改 handleCoordinatorDelegateSend**

```typescript
// process-manager.ts handleCoordinatorDelegateSend
private async handleCoordinatorDelegateSend(
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_send" }>,
): Promise<{ delivered: boolean; targetStatus: "active" | "started" | "not_found" }> {
  const { targetSessionId, message, mode = "followUp" } = msg;  // 默认 followUp

  // ... 现有的 target 查找/重启逻辑不变 ...

  // 修改消息投递逻辑 (原 line 2538-2542)
  if (target.info.status === "streaming") {
    if (mode === "steer") {
      this.steer(targetSessionId, wrappedMessage);      // 新增: 打断式
    } else {
      this.followUp(targetSessionId, wrappedMessage);   // 原逻辑
    }
  } else {
    this.send(targetSessionId, wrappedMessage);
  }

  return { delivered: true, targetStatus: "active" };
}
```

**Step 2: 单元测试**

```typescript
// test/coordinator-steer-mode.test.ts
describe("handleCoordinatorDelegateSend mode parameter", () => {
  it("should use followUp when mode is 'followUp' and target is streaming", () => {});
  it("should use steer when mode is 'steer' and target is streaming", () => {});
  it("should use send when target is idle regardless of mode", () => {});
  it("should default to followUp when mode is not specified", () => {});
});
```

**Step 3: Commit**

```bash
git commit -m "feat: implement steer mode for session_delegate_send"
```

---

## Phase 3: Subagent-v2 架构重构（核心）

> subagent-v2 不再自己 spawn RpcClient，改为通过 coordinator channel 让 Process Manager 创建子会话。

### Task 6: Coordinator 新增 `session_delegate_sync` 方法

> 这个方法创建子会话并阻塞等待结果，满足 subagent 的同步语义。

**Files:**

- Modify: `pi-momo-fork/packages/coding-agent/extensions/coordinator/types.ts`
- Modify: `src/shared/modules/coordinator.ts`
- Modify: `src/shared/agent/process-manager.ts`

**Step 1: 后端 contract — 新增方法定义**

```typescript
// coordinator/types.ts — 在 methods 中新增
session_delegate_sync: {
  params: {
    task: string;
    agent?: string;
    timeoutMs?: number;
    projectPath?: string;
  };
  return: {
    sessionId: string;
    status: "completed" | "timeout" | "error" | "aborted";
    exitCode: number;
    finalText: string;
    error?: string;
  };
};
```

**Step 2: 前端 types — 同步**

```typescript
// coordinator.ts — CoordinatorMethods 新增
"coordinator.delegate_sync": {
  params: {
    task: string;
    agent?: string;
    timeoutMs?: number;
  };
  result: {
    sessionId: string;
    status: "completed" | "timeout" | "error" | "aborted";
    exitCode: number;
    finalText: string;
    error?: string;
  };
};
```

```typescript
// coordinator.ts — CoordinatorMethodCall 新增
| {
    __call: "session_delegate_sync";
    task: string;
    agent?: string;
    timeoutMs?: number;
    projectPath?: string;
    invokeId?: string;
  }
```

```typescript
// coordinator.ts — CoordinatorMethodResponse 新增
| { method: "session_delegate_sync"; result: { sessionId: string; status: string; exitCode: number; finalText: string; error?: string } }
```

**Step 3: Process Manager 实现**

在 `process-manager.ts` 中新增 `handleCoordinatorDelegateSync`：

```typescript
// process-manager.ts — 新增方法
private async handleCoordinatorDelegateSync(
  parentSessionId: string,
  msg: Extract<CoordinatorMethodCall, { __call: "session_delegate_sync" }>,
): Promise<{ sessionId: string; status: string; exitCode: number; finalText: string; error?: string }> {
  const { task, agent, timeoutMs = 300000, projectPath } = msg;

  // 1. 找到父会话的 projectPath
  const parent = this.clients.get(parentSessionId);
  const cwd = projectPath ?? parent?.info.projectPath ?? "";

  // 2. 创建子会话 (复用 handleCoordinatorDelegate 的创建逻辑)
  const newSessionId = `sess_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sessionDir = parent?.info.sessionPath ? path.dirname(parent.info.sessionPath) : "";
  const sessionPath = path.join(sessionDir, `${newSessionId}.jsonl`);

  // 记录父子关系
  if (!this.parentChildMap.has(parentSessionId)) this.parentChildMap.set(parentSessionId, new Set());
  this.parentChildMap.get(parentSessionId)!.add(newSessionId);
  this.delegateCreatedAt.set(newSessionId, Date.now());

  // 3. 创建进程并发送 prompt
  const delegatePrompt = [
    `[系统提示] 你是一个子代理任务会话。`,
    agent ? `Agent 角色: ${agent}` : "",
    `任务: ${task}`,
    ``,
    task,
  ].filter(Boolean).join("\n");

  const startResult = await this.start(newSessionId, cwd, sessionPath);
  this.send(newSessionId, delegatePrompt);

  // 4. 阻塞等待 agent_end 或超时
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      this.offAgentEnd(newSessionId, handler);
      resolve({
        sessionId: newSessionId,
        status: "timeout",
        exitCode: 1,
        finalText: "(timed out)",
      });
    }, timeoutMs);

    const handler = (sid: string) => {
      if (sid !== newSessionId) return;
      clearTimeout(timeout);
      this.offAgentEnd(newSessionId, handler);
      // 读取最后消息作为 finalText
      resolve({
        sessionId: newSessionId,
        status: "completed",
        exitCode: 0,
        finalText: "(completed)", // 从 session 数据中提取
      });
    };
    this.onAgentEnd(handler);
  });
}
```

> **注意：** Process Manager 需要新增 `onAgentEnd` / `offAgentEnd` 事件注册机制。可以用简单的 `EventEmitter` 或手动维护 listener 列表。在现有的 `handleEvent` 方法中，当 `event.type === "agent_end"` 时触发这些 listeners。

**Step 4: 注册到 handleCoordinatorCall**

```typescript
// process-manager.ts handleCoordinatorCall 的 switch 中新增
case "session_delegate_sync": {
  result = await this.handleCoordinatorDelegateSync(sessionId, msg);
  break;
}
```

**Step 5: Commit**

```bash
git commit -m "feat: add session_delegate_sync for synchronous subagent dispatch"
```

---

### Task 7: 重构 subagent-v2 extension 使用 channel dispatch

**Files:**

- Modify: `pi-momo-fork/packages/coding-agent/extensions/subagent-v2/index.ts`

**Step 1: 简化 execute 函数 — foreground path**

将 foreground path 从 `new RpcClient → start → prompt → waitForIdle` 改为：

```typescript
// 新的 foreground path (替换 lines 414-489)
try {
  // 不再自己 spawn，通过 coordinator channel 创建
  const result = await pi.channel("coordinator").call("session_delegate_sync", {
    task: params.task,
    agent: params.agent,
    timeoutMs,
    projectPath: params.cwd ?? ctx.cwd,
  });

  // 广播 subagent_start 事件 (修复之前的 bug)
  channel.emit("subagent_start", {
    event: {
      type: "subagent_start",
      toolCallId,
      description: params.agent,
      instruction: params.task,
    },
    sessionId: result.sessionId,
  });

  pi.appendEntry("subagent", {
    toolCallId,
    sessionId: result.sessionId,
    sessionPath: "", // 由 Process Manager 管理
    description: params.agent,
    instruction: params.task,
    startedAt,
    completedAt: Date.now(),
    exitCode: result.exitCode,
    finalText: result.finalText,
  });

  if (result.exitCode !== 0) {
    return {
      content: [
        { type: "text", text: `Agent ${result.status}: ${result.error || result.finalText}` },
      ],
      details,
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: result.finalText }],
    details: { ...details, result },
  };
} catch (err) {
  return {
    content: [
      { type: "text", text: `Agent failed: ${err instanceof Error ? err.message : String(err)}` },
    ],
    details,
    isError: true,
  };
}
```

**Step 2: 砍掉 background path + subscribeToClient + runWithTimeout + handleGracePeriod**

以下函数/代码块可以安全删除：

- `subscribeToClient` (lines 78-114) — 不再需要，Process Manager 直接管 channel
- `runWithTimeout` (lines 116-150) — 不再需要
- `handleGracePeriod` (lines 152-167) — 不再需要（由 Process Manager 的 delegate_sync 内部处理超时）
- Background path (lines 335-412) — 用 coordinator `session_delegate` 替代
- `backgroundTasks` Map (line 52) — 不再需要
- `process.on("exit", cleanupBackgroundTasks)` — 不再需要
- `client` 相关的所有代码（start, stop, setActiveTools, etc.）

**Step 3: 保留的功能**

- Agent discovery (`discoverAgents`) — 仍然需要
- 参数验证 — 仍然需要
- `confirmProjectAgents` 权限确认 — 仍然需要（但权限现在由 Process Manager 的子会话处理）
- `pi.appendEntry("subagent", ...)` — 仍然需要
- `subagent_resume` tool — 需要改为调用 coordinator channel

**Step 4: 更新 subagent_resume**

```typescript
// subagent_resume 也改为走 coordinator
// 从 sessionPath 读取历史 session 数据，发起新的 delegate_sync
```

**Step 5: Commit**

```bash
git commit -m "refactor: subagent-v2 uses coordinator channel for process management"
```

---

### Task 8: 前端 subagent 事件路由适配

> Process Manager 创建的子会话，其事件需要被正确路由到 subagent store。

**Files:**

- Modify: `src/shared/agent/process-manager.ts` (handleCoordinatorDelegateSync 中的事件广播)
- Modify: `src/mainview/stores/session-subscriptions.ts` (订阅逻辑)

**Step 1: Process Manager 在 delegate_sync 子会话事件中广播 subagent.event**

当 `session_delegate_sync` 创建的子会话产生事件时，需要将其作为 `subagent.event` 广播（而不是普通的 `agent.event`）。

在 `handleCoordinatorDelegateSync` 中注册子会话的事件监听：

```typescript
// 当子会话被 start() 创建后，其事件会通过正常的 handleEvent 流
// 需要识别它是 delegate_sync 的子会话，并将其路由为 subagent.event
```

**方案：** 在 `handleEvent` 中增加判断 — 如果 event 的 sessionId 在 `parentChildMap` 中存在，且父会话正在等待 delegate_sync 结果，则同时广播为 `subagent.event`。

```typescript
// process-manager.ts handleEvent 中新增
if (this.parentChildMap.has ...) {
  // 找到这个子会话的父
  for (const [parentId, children] of this.parentChildMap) {
    if (children.has(sessionId)) {
      // 同时广播为 subagent.event
      this.broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: this.sessionPaths.get(parentId) ?? "",
        subSessionId: sessionId,
        event: sanitized,
      }, { parentSessionId: parentId });
      break;
    }
  }
}
```

**Step 2: 确保前端 session-subscriptions 正确消费**

`session-subscriptions.ts` 已经订阅了 `"subagent.event"`，不需要改动。但需要确认 `handleSubagentEvent` 能正确处理来自 Process Manager 子会话的事件格式。

**Step 3: Commit**

```bash
git commit -m "feat: route delegate_sync child events as subagent.event"
```

---

### Task 4 → 8 的完整验证

**Step 1: 启动 dev server**

```bash
cd pi-agent-chat && bun run dev
```

**Step 2: 在 UI 中测试完整流程**

1. 创建新会话
2. 让 agent 调用 subagent tool（foreground 模式）
3. 验证：
   - 侧边栏出现 subagent 条目 ✅
   - 主聊天出现 SubagentExecutionCard ✅
   - 权限弹窗能正常弹出并被用户操作 ✅
   - subagent 完成后结果返回给父 LLM ✅
   - 点击 subagent 能切换到子会话视图 ✅
4. 测试 delegate_send 的 steer 模式：
   - 委派一个长任务
   - 用 `delegate_send({ mode: "steer" })` 发送打断消息
   - 验证子 agent 在当前 turn 结束后立即处理 steer 消息 ✅

**Step 3: 运行全部测试**

```bash
bun test
```

**Step 4: Final commit**

```bash
git commit -m "feat: complete subagent-v2 refactor with channel dispatch"
```

---

## 文件修改清单

| 文件                                                       | 改动                                         | Phase |
| ---------------------------------------------------------- | -------------------------------------------- | ----- |
| `pi-momo-fork/.../subagent-v2/index.ts`                    | 简化为 channel dispatch，删除 RpcClient 管理 | 3     |
| `pi-momo-fork/.../subagent-v2/subagent-shared/contract.ts` | 可能需要更新事件类型                         | 3     |
| `pi-momo-fork/.../coordinator/types.ts`                    | 新增 delegate_sync，delegate_send 加 mode    | 2+3   |
| `pi-agent-chat/.../process-manager.ts`                     | 实现 delegate_sync，steer 模式，事件路由     | 2+3   |
| `pi-agent-chat/.../coordinator.ts`                         | 前端类型同步                                 | 2+3   |
| `pi-agent-chat/.../use-subagent-store.ts`                  | 修复 subToolCallNameMap 泄漏                 | 1     |
| `pi-agent-chat/.../session-subscriptions.ts`               | cleanupSessionData 增加 subagent 清理        | 1     |

## 风险点

1. **Process Manager 的 onAgentEnd 机制** — 需要新增，可能影响现有事件流
2. **delegate_sync 的阻塞等待** — Process Manager 的 handler 是 async，需要在 Promise 上等待，可能影响并发
3. **subagent_resume 兼容性** — 旧的 session 文件格式可能不兼容新的 channel dispatch 模式
4. **前端事件格式兼容** — 确保 Process Manager 广播的 subagent.event 格式与当前 subagent-v2 channel emit 的格式一致
